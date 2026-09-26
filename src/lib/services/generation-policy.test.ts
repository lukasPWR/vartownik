import { describe, expect, it, vi } from "vitest";

import { GenerationAdmissionError, GenerationBudgetExceededError } from "@/lib/errors";
import {
  GENERATION_MODEL_PRICING,
  GENERATION_POLICY,
  admitGenerationRequest,
  type GenerationAdmissionRequest,
  type GenerationBudgetProjection,
} from "@/lib/services/generation-policy";

const VALID_REQUEST: GenerationAdmissionRequest = {
  provider: "openai",
  model: "gpt-6-luna",
  promptVersion: "v1",
  requestedQuestionsCount: 40,
};

const VALID_BUDGET: GenerationBudgetProjection = {
  attemptCount: 6,
  retryCount: 2,
  inputTokensPerAttempt: 1_000,
  outputTokensPerAttempt: 4_096,
  deadlineMs: 40_000,
};

function admissionBeforeProvider(
  request: GenerationAdmissionRequest,
  budget: GenerationBudgetProjection,
  providerCall = vi.fn()
) {
  const admission = admitGenerationRequest(request, { budget });
  providerCall();
  return { admission, providerCall };
}

describe("generation admission policy", () => {
  it("admits the canonical 40-question request within every configured ceiling", () => {
    const { admission, providerCall } = admissionBeforeProvider(VALID_REQUEST, VALID_BUDGET);

    expect(GENERATION_POLICY).toMatchObject({
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
    expect(admission.chunkCount).toBe(4);
    expect(admission.worstCaseCostUsd).toBeCloseTo(0.012888, 6);
    expect(providerCall).toHaveBeenCalledOnce();
  });

  it.each([
    ["provider", { provider: "other" }],
    ["model", { model: "gpt-6-sol" }],
    ["prompt", { promptVersion: "v2" }],
    ["question count", { requestedQuestionsCount: 39 }],
  ])("rejects an unknown %s before provider access", (_label, override) => {
    const providerCall = vi.fn();

    expect(() => admissionBeforeProvider({ ...VALID_REQUEST, ...override }, VALID_BUDGET, providerCall)).toThrow(
      GenerationAdmissionError
    );
    expect(providerCall).not.toHaveBeenCalled();
  });

  it("rejects a model whose price is unavailable before provider access", () => {
    const providerCall = vi.fn();

    expect(() => {
      const admission = admitGenerationRequest(VALID_REQUEST, { budget: VALID_BUDGET, pricing: {} });
      providerCall(admission);
    }).toThrow(GenerationAdmissionError);
    expect(providerCall).not.toHaveBeenCalled();
  });

  it.each([
    ["attempt", { attemptCount: 7 }],
    ["retry", { retryCount: 3 }],
    ["output-token", { outputTokensPerAttempt: 4_097 }],
    ["deadline", { deadlineMs: 40_001 }],
    ["USD", { inputTokensPerAttempt: 13_000 }],
  ])("rejects a projected %s ceiling breach before provider access", (_label, override) => {
    const providerCall = vi.fn();

    expect(() => admissionBeforeProvider(VALID_REQUEST, { ...VALID_BUDGET, ...override }, providerCall)).toThrow(
      GenerationBudgetExceededError
    );
    expect(providerCall).not.toHaveBeenCalled();
  });

  it("keeps the allowlisted model price in the pure policy module", () => {
    expect(GENERATION_MODEL_PRICING["gpt-6-luna"]).toEqual({
      inputUsdPerMillionTokens: 0.1,
      cachedInputUsdPerMillionTokens: 0.01,
      outputUsdPerMillionTokens: 0.5,
    });
  });
});
