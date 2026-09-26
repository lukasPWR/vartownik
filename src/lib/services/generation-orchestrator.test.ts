import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiProviderError,
  GenerationBudgetExceededError,
  GenerationCancelledError,
  GenerationDeadlineError,
} from "@/lib/errors";
import { GENERATION_POLICY } from "@/lib/services/generation-policy";
import {
  orchestrateGeneration,
  type GenerationExecutionError,
  type GenerationExecutionPolicy,
  type GenerationProvider,
  type GenerationProviderRequest,
  type GenerationProviderResponse,
  type GenerationUsage,
} from "@/lib/services/generation-orchestrator";

const DEFAULT_USAGE: GenerationUsage = {
  inputTokens: 10,
  outputTokens: 20,
  observedCostUsd: 0.001,
};

function questions(count: number = GENERATION_POLICY.chunkSize, seed = 0) {
  return Array.from({ length: count }, (_, index) => ({
    question_text: `Question ${seed}-${index}`,
    correct_answer: {
      primary: `Answer ${seed}-${index}`,
      synonyms: [],
    },
    difficulty_score: 0.8,
    category_slug: "historia",
  }));
}

function response(
  count: number = GENERATION_POLICY.chunkSize,
  usage: GenerationUsage = DEFAULT_USAGE,
  seed = 0
): GenerationProviderResponse {
  return {
    data: { questions: questions(count, seed) },
    usage,
    complete: true,
  };
}

function providerFrom(
  implementation: (request: GenerationProviderRequest) => Promise<GenerationProviderResponse>
): GenerationProvider & { generate: ReturnType<typeof vi.fn> } {
  return { generate: vi.fn(implementation) };
}

function policy(overrides: Partial<GenerationExecutionPolicy> = {}): GenerationExecutionPolicy {
  return { ...GENERATION_POLICY, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("generation orchestrator", () => {
  it("aborts a never-settling provider at the batch deadline without starting another chunk", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let observedSignal: AbortSignal | undefined;
    let signalWasAborted = false;
    const provider = providerFrom(
      (request) =>
        new Promise(() => {
          observedSignal = request.signal;
          request.signal.addEventListener(
            "abort",
            () => {
              signalWasAborted = true;
            },
            { once: true }
          );
        })
    );

    const settled = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    }).catch((error: unknown) => error as GenerationExecutionError);

    await vi.advanceTimersByTimeAsync(GENERATION_POLICY.deadlineMs - 1);
    expect(signalWasAborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;

    expect(error).toBeInstanceOf(GenerationDeadlineError);
    expect(error.aggregate).toEqual({
      attemptCount: 1,
      retryCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      observedCostUsd: 0,
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(observedSignal?.aborted).toBe(true);
    expect(signalWasAborted).toBe(true);
  });

  it("uses exactly four provider calls for the happy path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let sequence = 0;
    const provider = providerFrom(async () => response(10, DEFAULT_USAGE, sequence++));

    const result = await orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    });

    expect(provider.generate).toHaveBeenCalledTimes(4);
    expect(result.questions).toHaveLength(40);
    expect(result.aggregate).toEqual({
      attemptCount: 4,
      retryCount: 0,
      inputTokens: 40,
      outputTokens: 80,
      observedCostUsd: 0.004,
    });
  });

  it("shares one retry budget across chunks and stops at six total attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requests: GenerationProviderRequest[] = [];
    let callIndex = 0;
    const provider = providerFrom(async (request) => {
      requests.push(request);
      callIndex += 1;
      if (callIndex === 1) throw new AiProviderError("rate limited", 429);
      if (callIndex === 2) throw new AiProviderError("unavailable", 503);
      return response(10, DEFAULT_USAGE, callIndex);
    });

    const resultPromise = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(provider.generate).toHaveBeenCalledTimes(6);
    expect(result.aggregate.attemptCount).toBe(6);
    expect(result.aggregate.retryCount).toBe(2);
    expect(requests.map((request) => request.timeoutMs)).toEqual([40_000, 39_000, 37_000, 37_000, 37_000, 37_000]);
    expect(new Set(requests.map((request) => request.signal)).size).toBe(1);
    expect(requests.every((request) => request.maxOutputTokens === 4_096)).toBe(true);
  });

  it("does not retry a permanent provider 4xx", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const provider = providerFrom(async () => {
      throw new AiProviderError("bad request", 400);
    });

    const error = await orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    }).catch((caught: unknown) => caught as GenerationExecutionError);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error.aggregate.attemptCount).toBe(1);
    expect(error.aggregate.retryCount).toBe(0);
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start another chunk after the global attempt budget is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let callIndex = 0;
    const provider = providerFrom(async () => {
      callIndex += 1;
      if (callIndex < 3) return response(9, DEFAULT_USAGE, callIndex);
      return response(10, DEFAULT_USAGE, callIndex);
    });

    const resultPromise = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
      policy: policy({ maxAttempts: 3 }),
    }).catch((caught: unknown) => caught as GenerationExecutionError);
    await vi.runAllTimersAsync();
    const error = await resultPromise;

    expect(error).toBeInstanceOf(GenerationBudgetExceededError);
    expect(error.aggregate.attemptCount).toBe(3);
    expect(error.aggregate.retryCount).toBe(2);
    expect(provider.generate).toHaveBeenCalledTimes(3);
  });

  it("accounts paid wrong-count usage before retrying and keeps observed cost separate from preflight ceiling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rejectedUsage: GenerationUsage = {
      inputTokens: 50,
      outputTokens: 70,
      observedCostUsd: 0.003,
    };
    let callIndex = 0;
    const provider = providerFrom(async () => {
      callIndex += 1;
      if (callIndex === 1) return response(9, rejectedUsage, callIndex);
      return response(10, DEFAULT_USAGE, callIndex);
    });

    const resultPromise = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(provider.generate).toHaveBeenCalledTimes(5);
    expect(result.aggregate).toEqual({
      attemptCount: 5,
      retryCount: 1,
      inputTokens: 90,
      outputTokens: 150,
      observedCostUsd: 0.007,
    });
    expect(result.preflightCostCeilingUsd).toBe(0.02);
    expect(result.aggregate.observedCostUsd).not.toBe(result.preflightCostCeilingUsd);
  });

  it("retries a structurally invalid paid response after accounting its usage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let callIndex = 0;
    const provider = providerFrom(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          data: { invalid: true },
          usage: DEFAULT_USAGE,
          complete: true,
        };
      }
      return response(10, DEFAULT_USAGE, callIndex);
    });

    const resultPromise = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(provider.generate).toHaveBeenCalledTimes(5);
    expect(result.aggregate).toMatchObject({
      attemptCount: 5,
      retryCount: 1,
      inputTokens: 50,
      outputTokens: 100,
      observedCostUsd: 0.005,
    });
  });

  it("does not retry or start another chunk after caller cancellation", async () => {
    const controller = new AbortController();
    const provider = providerFrom(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new AiProviderError("aborted", 503)), {
            once: true,
          });
        })
    );
    const settled = orchestrateGeneration({
      provider,
      deadlineAt: Date.now() + GENERATION_POLICY.deadlineMs,
      signal: controller.signal,
    }).catch((caught: unknown) => caught as GenerationExecutionError);

    controller.abort();
    const error = await settled;

    expect(error).toBeInstanceOf(GenerationCancelledError);
    expect(error.aggregate.attemptCount).toBe(1);
    expect(error.aggregate.retryCount).toBe(0);
    expect(provider.generate).toHaveBeenCalledOnce();
  });
});
