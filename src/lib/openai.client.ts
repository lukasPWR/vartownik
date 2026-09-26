import { OPENAI_API_KEY } from "astro:env/server";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError, type ZodType } from "zod";

import { AiParseError, AiProviderError, GenerationAdmissionError } from "@/lib/errors";
import type { AiMessage } from "@/lib/prompts/quiz-generation.v1";
import { GENERATION_MODEL_PRICING, GENERATION_POLICY } from "@/lib/services/generation-policy";
import type {
  GenerationProvider,
  GenerationProviderResponse,
  GenerationUsage,
} from "@/lib/services/generation-orchestrator";

export interface OpenAICallOptions {
  signal: AbortSignal;
  /** Remaining time before the aggregate batch deadline, in milliseconds. */
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface OpenAIResult<T> extends GenerationProviderResponse {
  data: T;
  usage: GenerationUsage;
  /** @deprecated Use usage.observedCostUsd. Kept until the legacy service is replaced. */
  estimatedCostUsd: number;
}

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new AiProviderError("OPENAI_API_KEY is not configured");
  }

  openaiClient ??= new OpenAI({
    apiKey: OPENAI_API_KEY,
    maxRetries: 0,
    timeout: GENERATION_POLICY.deadlineMs,
  });

  return openaiClient;
}

function normalizeModelId(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function assertCallOptions(options: OpenAICallOptions): void {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new GenerationAdmissionError("OpenAI timeout must be a positive remaining deadline.");
  }

  if (options.timeoutMs > GENERATION_POLICY.deadlineMs) {
    throw new GenerationAdmissionError("OpenAI timeout exceeds the generation deadline policy.");
  }

  if (options.maxOutputTokens !== GENERATION_POLICY.maxOutputTokensPerAttempt) {
    throw new GenerationAdmissionError(
      `OpenAI max output tokens must equal ${GENERATION_POLICY.maxOutputTokensPerAttempt}.`
    );
  }
}

function calculateObservedUsage(
  modelId: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number } | null;
  } | null
): GenerationUsage {
  const pricing = GENERATION_MODEL_PRICING[modelId];
  if (!pricing) {
    throw new GenerationAdmissionError("Generation model pricing is unavailable.");
  }

  if (!usage) {
    throw new AiProviderError("OpenAI response did not include usage metadata.");
  }

  const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncachedInputTokens = Math.max(0, usage.input_tokens - cachedInputTokens);
  const observedCostUsd =
    (uncachedInputTokens * pricing.inputUsdPerMillionTokens +
      cachedInputTokens * pricing.cachedInputUsdPerMillionTokens +
      usage.output_tokens * pricing.outputUsdPerMillionTokens) /
    1_000_000;

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    observedCostUsd,
  };
}

async function requestOpenAI<T>(
  model: string,
  messages: AiMessage[],
  responseSchema: ZodType<T>,
  options: OpenAICallOptions
): Promise<OpenAIResult<T>> {
  const modelId = normalizeModelId(model);

  if (!GENERATION_MODEL_PRICING[modelId]) {
    throw new GenerationAdmissionError("Generation model pricing is unavailable.");
  }
  assertCallOptions(options);

  try {
    const response = await getOpenAIClient().responses.parse(
      {
        model: modelId,
        input: messages,
        max_output_tokens: options.maxOutputTokens,
        text: {
          format: zodTextFormat(responseSchema, "quiz_questions"),
        },
      },
      {
        signal: options.signal,
        timeout: Math.floor(options.timeoutMs),
        maxRetries: 0,
      }
    );
    const usage = calculateObservedUsage(modelId, response.usage ?? null);
    const complete = response.status !== "incomplete" && response.output_parsed !== null;

    return {
      data: response.output_parsed as T,
      usage,
      complete,
      estimatedCostUsd: usage.observedCostUsd,
    };
  } catch (error) {
    if (error instanceof AiProviderError || error instanceof GenerationAdmissionError) {
      throw error;
    }

    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new AiParseError("OpenAI returned a structurally invalid response.");
    }

    if (error instanceof OpenAI.APIError) {
      throw new AiProviderError(`OpenAI returned HTTP ${error.status}: ${error.message}`, error.status);
    }

    const message = error instanceof Error ? error.message : "Network error";
    throw new AiProviderError(`OpenAI request failed: ${message}`);
  }
}

/**
 * Thin OpenAI adapter used by the execution orchestrator. Every call receives
 * the batch signal and the remaining aggregate deadline from its caller.
 */
export const openAIProvider: GenerationProvider = {
  async generate(request) {
    return requestOpenAI(request.model, request.messages, request.responseSchema, {
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      maxOutputTokens: request.maxOutputTokens,
    });
  },
};

/**
 * Calls the OpenAI Responses API and validates its Structured Output with Zod.
 * The defaults keep the existing service compiling until Phase 3 composes it
 * with `openAIProvider`; orchestrated calls always supply explicit values.
 */
export async function callOpenAI<T>(
  model: string,
  messages: AiMessage[],
  responseSchema: ZodType<T>,
  options: OpenAICallOptions = {
    signal: new AbortController().signal,
    timeoutMs: GENERATION_POLICY.deadlineMs,
    maxOutputTokens: GENERATION_POLICY.maxOutputTokensPerAttempt,
  }
): Promise<OpenAIResult<T>> {
  const result = await requestOpenAI(model, messages, responseSchema, options);

  if (result.complete === false) {
    throw new AiParseError("OpenAI returned an incomplete structured response.");
  }

  return result;
}
