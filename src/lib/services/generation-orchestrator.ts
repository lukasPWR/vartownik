import { z } from "zod";

import {
  AiParseError,
  AiProviderError,
  GenerationAdmissionError,
  GenerationBudgetExceededError,
  GenerationCancelledError,
  GenerationDeadlineError,
} from "@/lib/errors";
import { buildPrompt, type AiMessage } from "@/lib/prompts/quiz-generation.v1";
import { GENERATION_POLICY } from "@/lib/services/generation-policy";

const RETRY_BASE_DELAY_MS = 1_000;

const AiQuestionSchema = z.object({
  question_text: z.string().min(5).max(1_000),
  correct_answer: z.object({
    primary: z.string().min(1).max(1_000),
    synonyms: z.array(z.string()),
  }),
  difficulty_score: z.number().min(0).max(1),
  category_slug: z.string().min(1).max(100),
});

const AiResponseSchema = z.object({
  questions: z.array(AiQuestionSchema),
});

export type GeneratedQuestion = z.infer<typeof AiQuestionSchema>;

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  observedCostUsd: number;
}

export interface GenerationProviderRequest {
  model: string;
  messages: AiMessage[];
  responseSchema: typeof AiResponseSchema;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface GenerationProviderResponse {
  data: unknown;
  usage: GenerationUsage;
  /** False when the provider returned a paid but structurally incomplete response. */
  complete?: boolean;
}

export interface GenerationProvider {
  generate(request: GenerationProviderRequest): Promise<GenerationProviderResponse>;
}

export interface GenerationClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface GenerationExecutionPolicy {
  model: string;
  promptVersion: string;
  requestedQuestionsCount: number;
  chunkSize: number;
  maxAttempts: number;
  maxRetries: number;
  maxOutputTokensPerAttempt: number;
  preflightCostCeilingUsd: number;
}

export interface GenerationExecutionAggregate {
  attemptCount: number;
  retryCount: number;
  inputTokens: number;
  outputTokens: number;
  observedCostUsd: number;
}

export interface GenerationExecutionResult {
  questions: GeneratedQuestion[];
  aggregate: GenerationExecutionAggregate;
  preflightCostCeilingUsd: number;
}

export type GenerationExecutionError = Error & {
  readonly aggregate: GenerationExecutionAggregate;
};

export interface GenerationOrchestratorOptions {
  provider: GenerationProvider;
  deadlineAt: number;
  clock?: GenerationClock;
  policy?: GenerationExecutionPolicy;
  signal?: AbortSignal;
}

class SleepAbortedError extends Error {
  constructor() {
    super("Sleep aborted.");
    this.name = "SleepAbortedError";
  }
}

const systemClock: GenerationClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new SleepAbortedError());
        return;
      }

      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", handleAbort);
        resolve();
      }, ms);
      const handleAbort = () => {
        clearTimeout(timeout);
        reject(new SleepAbortedError());
      };

      signal.addEventListener("abort", handleAbort, { once: true });
    }),
};

function createEmptyAggregate(): GenerationExecutionAggregate {
  return {
    attemptCount: 0,
    retryCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    observedCostUsd: 0,
  };
}

function snapshotAggregate(aggregate: GenerationExecutionAggregate): GenerationExecutionAggregate {
  return { ...aggregate };
}

function withAggregate(error: Error, aggregate: GenerationExecutionAggregate): GenerationExecutionError {
  Object.defineProperty(error, "aggregate", {
    configurable: true,
    enumerable: true,
    value: snapshotAggregate(aggregate),
    writable: false,
  });

  return error as GenerationExecutionError;
}

function assertUsage(usage: GenerationUsage): void {
  if (
    !Number.isSafeInteger(usage.inputTokens) ||
    usage.inputTokens < 0 ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.outputTokens < 0 ||
    !Number.isFinite(usage.observedCostUsd) ||
    usage.observedCostUsd < 0
  ) {
    throw new AiParseError("AI provider returned invalid usage metadata.");
  }
}

function addUsage(aggregate: GenerationExecutionAggregate, usage: GenerationUsage): void {
  assertUsage(usage);
  aggregate.inputTokens += usage.inputTokens;
  aggregate.outputTokens += usage.outputTokens;
  aggregate.observedCostUsd += usage.observedCostUsd;
}

function isRetryable(error: Error): boolean {
  if (error instanceof AiParseError) return true;
  if (!(error instanceof AiProviderError) || error.statusCode === undefined) return false;

  return error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode <= 599);
}

function retryDelayMs(retryCount: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** retryCount;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new AiProviderError(`AI provider failed: ${String(error)}`);
}

function lifecycleError(deadlineReached: boolean, aggregate: GenerationExecutionAggregate): GenerationExecutionError {
  return withAggregate(deadlineReached ? new GenerationDeadlineError() : new GenerationCancelledError(), aggregate);
}

function assertExecutionPolicy(policy: GenerationExecutionPolicy): void {
  const integerFields = [
    policy.requestedQuestionsCount,
    policy.chunkSize,
    policy.maxAttempts,
    policy.maxRetries,
    policy.maxOutputTokensPerAttempt,
  ];

  if (integerFields.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new GenerationAdmissionError("Generation execution policy contains invalid limits.");
  }

  if (policy.promptVersion !== "v1") {
    throw new GenerationAdmissionError("Generation prompt version is not supported.");
  }

  if (policy.requestedQuestionsCount % policy.chunkSize !== 0) {
    throw new GenerationAdmissionError("Generation question count must divide evenly into chunks.");
  }
}

async function waitForBackoff(
  delayMs: number,
  deadlineAt: number,
  clock: GenerationClock,
  batchController: AbortController,
  aggregate: GenerationExecutionAggregate
): Promise<void> {
  const remainingMs = deadlineAt - clock.now();
  if (remainingMs <= 0) {
    batchController.abort();
    throw withAggregate(new GenerationDeadlineError(), aggregate);
  }

  try {
    await clock.sleep(Math.min(delayMs, remainingMs), batchController.signal);
  } catch (error) {
    if (batchController.signal.aborted) {
      throw lifecycleError(clock.now() >= deadlineAt, aggregate);
    }
    throw error;
  }

  if (delayMs >= remainingMs || clock.now() >= deadlineAt) {
    batchController.abort();
    throw withAggregate(new GenerationDeadlineError(), aggregate);
  }
}

async function callProviderBeforeDeadline(
  request: Omit<GenerationProviderRequest, "signal" | "timeoutMs">,
  options: {
    provider: GenerationProvider;
    clock: GenerationClock;
    deadlineAt: number;
    batchController: AbortController;
    aggregate: GenerationExecutionAggregate;
  }
): Promise<GenerationProviderResponse> {
  const { provider, clock, deadlineAt, batchController, aggregate } = options;
  const remainingMs = deadlineAt - clock.now();

  if (remainingMs <= 0) {
    batchController.abort();
    throw withAggregate(new GenerationDeadlineError(), aggregate);
  }

  const deadlineTimer = new AbortController();
  let deadlineReached = false;
  let removeAbortListener: () => void = () => undefined;
  const deadlinePromise = clock.sleep(remainingMs, deadlineTimer.signal).then(() => {
    deadlineReached = true;
    batchController.abort();
    throw withAggregate(new GenerationDeadlineError(), aggregate);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const handleAbort = () => {
      reject(lifecycleError(deadlineReached || clock.now() >= deadlineAt, aggregate));
    };

    if (batchController.signal.aborted) {
      handleAbort();
      return;
    }

    batchController.signal.addEventListener("abort", handleAbort, { once: true });
    removeAbortListener = () => batchController.signal.removeEventListener("abort", handleAbort);
  });

  try {
    return await Promise.race([
      provider.generate({
        ...request,
        signal: batchController.signal,
        timeoutMs: remainingMs,
      }),
      deadlinePromise,
      abortPromise,
    ]);
  } catch (error) {
    if (batchController.signal.aborted) {
      throw lifecycleError(deadlineReached || clock.now() >= deadlineAt, aggregate);
    }
    throw error;
  } finally {
    removeAbortListener();
    deadlineTimer.abort();
  }
}

/**
 * Executes every chunk under one deadline, cancellation signal, attempt budget,
 * and retry budget. It performs no persistence and imports no provider SDK.
 */
export async function orchestrateGeneration(
  options: GenerationOrchestratorOptions
): Promise<GenerationExecutionResult> {
  const policy = options.policy ?? GENERATION_POLICY;
  const clock = options.clock ?? systemClock;
  const aggregate = createEmptyAggregate();

  try {
    assertExecutionPolicy(policy);
  } catch (error) {
    throw withAggregate(toError(error), aggregate);
  }

  const batchController = new AbortController();
  const handleCallerAbort = () => batchController.abort();

  if (options.signal?.aborted) {
    batchController.abort();
  } else {
    options.signal?.addEventListener("abort", handleCallerAbort, { once: true });
  }

  const chunkCount = policy.requestedQuestionsCount / policy.chunkSize;
  let reservedRetries = 0;

  try {
    if (batchController.signal.aborted) {
      throw lifecycleError(false, aggregate);
    }

    async function generateChunk(): Promise<GeneratedQuestion[]> {
      let retryReserved = false;
      while (true) {
        if (retryReserved) reservedRetries -= 1;
        if (batchController.signal.aborted) {
          throw lifecycleError(clock.now() >= options.deadlineAt, aggregate);
        }

        if (clock.now() >= options.deadlineAt) {
          batchController.abort();
          throw withAggregate(new GenerationDeadlineError(), aggregate);
        }

        if (aggregate.attemptCount >= policy.maxAttempts) {
          throw withAggregate(new GenerationBudgetExceededError("Generation attempt budget exhausted."), aggregate);
        }

        if (retryReserved) aggregate.retryCount += 1;
        aggregate.attemptCount += 1;

        try {
          const response = await callProviderBeforeDeadline(
            {
              model: policy.model,
              messages: buildPrompt(policy.chunkSize),
              responseSchema: AiResponseSchema,
              maxOutputTokens: policy.maxOutputTokensPerAttempt,
            },
            {
              provider: options.provider,
              clock,
              deadlineAt: options.deadlineAt,
              batchController,
              aggregate,
            }
          );

          addUsage(aggregate, response.usage);

          if (response.complete === false) {
            throw new AiParseError("AI provider returned an incomplete structured response.");
          }

          const parsed = AiResponseSchema.safeParse(response.data);
          if (!parsed.success) {
            throw new AiParseError("AI provider returned a structurally invalid response.");
          }

          if (parsed.data.questions.length !== policy.chunkSize) {
            throw new AiParseError(
              `AI provider returned ${parsed.data.questions.length} questions instead of ${policy.chunkSize}.`
            );
          }

          return parsed.data.questions;
        } catch (error) {
          if (batchController.signal.aborted || clock.now() >= options.deadlineAt) {
            batchController.abort();
            throw lifecycleError(clock.now() >= options.deadlineAt, aggregate);
          }

          const executionError = toError(error);
          if (!isRetryable(executionError)) {
            throw withAggregate(executionError, aggregate);
          }

          if (aggregate.retryCount + reservedRetries >= policy.maxRetries) {
            throw withAggregate(executionError, aggregate);
          }

          if (aggregate.attemptCount + reservedRetries >= policy.maxAttempts) {
            throw withAggregate(
              new GenerationBudgetExceededError("Generation attempt budget prevented another retry."),
              aggregate
            );
          }

          reservedRetries += 1;
          try {
            await waitForBackoff(
              retryDelayMs(aggregate.retryCount + reservedRetries - 1),
              options.deadlineAt,
              clock,
              batchController,
              aggregate
            );
          } catch (backoffError) {
            reservedRetries -= 1;
            throw backoffError;
          }
          retryReserved = true;
        }
      }
    }

    if (chunkCount > policy.maxAttempts) {
      throw new GenerationBudgetExceededError("Generation needs more initial attempts than the policy allows.");
    }

    let firstFailure: Error | null = null;
    const tasks = Array.from({ length: chunkCount }, () =>
      generateChunk().catch((error: unknown) => {
        if (!firstFailure) firstFailure = toError(error);
        batchController.abort();
        throw error;
      })
    );
    const outcomes = await Promise.allSettled(tasks);
    if (firstFailure) throw firstFailure;

    return {
      questions: outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? outcome.value : [])),
      aggregate: snapshotAggregate(aggregate),
      preflightCostCeilingUsd: policy.preflightCostCeilingUsd,
    };
  } catch (error) {
    throw withAggregate(toError(error), aggregate);
  } finally {
    options.signal?.removeEventListener("abort", handleCallerAbort);
  }
}
