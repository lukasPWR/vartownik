import { GenerationAdmissionError, GenerationBudgetExceededError } from "@/lib/errors";

const TOKENS_PER_MILLION = 1_000_000;

export interface ModelPricing {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export const GENERATION_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  "gpt-6-luna": Object.freeze({
    inputUsdPerMillionTokens: 0.1,
    cachedInputUsdPerMillionTokens: 0.01,
    outputUsdPerMillionTokens: 0.5,
  }),
});

export const GENERATION_POLICY = Object.freeze({
  provider: "openai",
  model: "gpt-6-luna",
  promptVersion: "v1",
  requestedQuestionsCount: 40,
  chunkSize: 10,
  maxAttempts: 6,
  maxRetries: 2,
  maxOutputTokensPerAttempt: 4_096,
  deadlineMs: 40_000,
  preflightCostCeilingUsd: 0.02,
});

export type GenerationPolicy = typeof GENERATION_POLICY;

export interface GenerationAdmissionRequest {
  provider: string;
  model: string;
  promptVersion: string;
  requestedQuestionsCount: number;
}

/** Conservative execution inputs known before the first provider call. */
export interface GenerationBudgetProjection {
  attemptCount: number;
  retryCount: number;
  inputTokensPerAttempt: number;
  outputTokensPerAttempt: number;
  deadlineMs: number;
}

export interface GenerationAdmission {
  chunkCount: number;
  worstCaseCostUsd: number;
  budget: GenerationBudgetProjection;
}

export interface GenerationAdmissionOptions {
  budget: GenerationBudgetProjection;
  pricing?: Readonly<Record<string, ModelPricing>>;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GenerationAdmissionError(`${label} must be a non-negative integer.`);
  }
}

export function calculateWorstCaseCostUsd(
  pricing: ModelPricing,
  budget: Pick<GenerationBudgetProjection, "attemptCount" | "inputTokensPerAttempt" | "outputTokensPerAttempt">
): number {
  const inputCost = budget.inputTokensPerAttempt * pricing.inputUsdPerMillionTokens;
  const outputCost = budget.outputTokensPerAttempt * pricing.outputUsdPerMillionTokens;

  return (budget.attemptCount * (inputCost + outputCost)) / TOKENS_PER_MILLION;
}

/**
 * Validates the immutable request allowlist and the caller's conservative
 * preflight projection. This module has no provider, persistence, or DOM imports.
 */
export function admitGenerationRequest(
  request: GenerationAdmissionRequest,
  options: GenerationAdmissionOptions
): GenerationAdmission {
  if (request.provider !== GENERATION_POLICY.provider) {
    throw new GenerationAdmissionError("Generation provider is not allowed.");
  }

  if (request.model !== GENERATION_POLICY.model) {
    throw new GenerationAdmissionError("Generation model is not allowed.");
  }

  if (request.promptVersion !== GENERATION_POLICY.promptVersion) {
    throw new GenerationAdmissionError("Generation prompt version is not allowed.");
  }

  if (request.requestedQuestionsCount !== GENERATION_POLICY.requestedQuestionsCount) {
    throw new GenerationAdmissionError(
      `Generation requires exactly ${GENERATION_POLICY.requestedQuestionsCount} questions.`
    );
  }

  const pricing = (options.pricing ?? GENERATION_MODEL_PRICING)[request.model];
  if (!pricing || Object.values(pricing).some((price) => !Number.isFinite(price) || price < 0)) {
    throw new GenerationAdmissionError("Generation model pricing is unavailable.");
  }

  const { budget } = options;
  assertNonNegativeInteger(budget.attemptCount, "Attempt count");
  assertNonNegativeInteger(budget.retryCount, "Retry count");
  assertNonNegativeInteger(budget.inputTokensPerAttempt, "Input tokens per attempt");
  assertNonNegativeInteger(budget.outputTokensPerAttempt, "Output tokens per attempt");
  assertNonNegativeInteger(budget.deadlineMs, "Deadline");

  if (budget.attemptCount > GENERATION_POLICY.maxAttempts) {
    throw new GenerationBudgetExceededError("Generation attempt budget exceeds the policy ceiling.");
  }

  if (budget.retryCount > GENERATION_POLICY.maxRetries) {
    throw new GenerationBudgetExceededError("Generation retry budget exceeds the policy ceiling.");
  }

  if (budget.outputTokensPerAttempt > GENERATION_POLICY.maxOutputTokensPerAttempt) {
    throw new GenerationBudgetExceededError("Generation output-token budget exceeds the policy ceiling.");
  }

  if (budget.deadlineMs > GENERATION_POLICY.deadlineMs) {
    throw new GenerationBudgetExceededError("Generation deadline exceeds the policy ceiling.");
  }

  const worstCaseCostUsd = calculateWorstCaseCostUsd(pricing, budget);
  if (!Number.isFinite(worstCaseCostUsd) || worstCaseCostUsd > GENERATION_POLICY.preflightCostCeilingUsd) {
    throw new GenerationBudgetExceededError("Generation worst-case cost exceeds the policy ceiling.");
  }

  return {
    chunkCount: request.requestedQuestionsCount / GENERATION_POLICY.chunkSize,
    worstCaseCostUsd,
    budget: { ...budget },
  };
}
