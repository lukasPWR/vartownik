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
  it("aborts all four active chunks at the batch deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const observedSignals: AbortSignal[] = [];
    const provider = providerFrom(
      (request) =>
        new Promise(() => {
          observedSignals.push(request.signal);
        })
    );

    const settled = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    }).catch((error: unknown) => error as GenerationExecutionError);

    await vi.advanceTimersByTimeAsync(GENERATION_POLICY.deadlineMs - 1);
    expect(observedSignals).toHaveLength(4);
    expect(observedSignals.every((signal) => !signal.aborted)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;

    expect(error).toBeInstanceOf(GenerationDeadlineError);
    expect(error.aggregate).toEqual({
      attemptCount: 4,
      retryCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      observedCostUsd: 0,
    });
    expect(provider.generate).toHaveBeenCalledTimes(4);
    expect(new Set(observedSignals).size).toBe(1);
    expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("starts four chunks together and preserves their output order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let sequence = 0;
    const provider = providerFrom(async () => {
      const index = sequence++;
      await new Promise((resolve) => setTimeout(resolve, [15_000, 5_000, 10_000, 2_000][index]));
      return response(10, DEFAULT_USAGE, index);
    });

    const resultPromise = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
    });
    expect(provider.generate).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await resultPromise;

    expect(provider.generate).toHaveBeenCalledTimes(4);
    expect(result.questions).toHaveLength(40);
    expect([0, 1, 2, 3].map((index) => result.questions[index * 10].question_text)).toEqual([
      "Question 0-0",
      "Question 1-0",
      "Question 2-0",
      "Question 3-0",
    ]);
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
    expect(requests.map((request) => request.timeoutMs)).toEqual([40_000, 40_000, 40_000, 40_000, 39_000, 38_000]);
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
    expect(error.aggregate.attemptCount).toBe(4);
    expect(error.aggregate.retryCount).toBe(0);
    expect(provider.generate).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a retry after the global attempt budget is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let callIndex = 0;
    const provider = providerFrom(async () => {
      const index = callIndex++;
      return response(index === 0 ? 9 : 10, DEFAULT_USAGE, index);
    });

    const resultPromise = orchestrateGeneration({
      provider,
      deadlineAt: GENERATION_POLICY.deadlineMs,
      policy: policy({ maxAttempts: 4 }),
    }).catch((caught: unknown) => caught as GenerationExecutionError);
    await vi.runAllTimersAsync();
    const error = await resultPromise;

    expect(error).toBeInstanceOf(GenerationBudgetExceededError);
    expect(error.aggregate.attemptCount).toBe(4);
    expect(error.aggregate.retryCount).toBe(0);
    expect(provider.generate).toHaveBeenCalledTimes(4);
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

  it("does not retry after caller cancellation and aborts every active chunk", async () => {
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
    expect(error.aggregate.attemptCount).toBe(4);
    expect(error.aggregate.retryCount).toBe(0);
    expect(provider.generate).toHaveBeenCalledTimes(4);
  });
});
