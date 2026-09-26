import { OPENAI_API_KEY } from "astro:env/server";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

import { AiProviderError } from "@/lib/errors";
import type { AiMessage } from "@/lib/prompts/quiz-generation.v1";

const REQUEST_TIMEOUT_MS = 60_000;

interface ModelPricing {
  input: number;
  cachedInput: number;
  output: number;
}

const COST_PER_MILLION_TOKENS: Record<string, ModelPricing> = {
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
};

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new AiProviderError("OPENAI_API_KEY is not configured");
  }

  openaiClient ??= new OpenAI({
    apiKey: OPENAI_API_KEY,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });

  return openaiClient;
}

function normalizeModelId(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function estimateOpenAICost(
  modelId: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number } | null;
  } | null
): number | null {
  const pricing = COST_PER_MILLION_TOKENS[modelId];
  if (!pricing || !usage) return null;

  const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncachedInputTokens = Math.max(0, usage.input_tokens - cachedInputTokens);
  const cost =
    (uncachedInputTokens * pricing.input +
      cachedInputTokens * pricing.cachedInput +
      usage.output_tokens * pricing.output) /
    1_000_000;

  return Number(cost.toFixed(6));
}

/** Calls the OpenAI Responses API and validates its Structured Output with Zod. */
export async function callOpenAI<T>(
  model: string,
  messages: AiMessage[],
  responseSchema: ZodType<T>
): Promise<{ data: T; estimatedCostUsd: number | null }> {
  const modelId = normalizeModelId(model);

  try {
    const response = await getOpenAIClient().responses.parse({
      model: modelId,
      input: messages,
      max_output_tokens: 8192,
      text: {
        format: zodTextFormat(responseSchema, "quiz_questions"),
      },
    });

    if (response.status === "incomplete") {
      throw new AiProviderError(
        `OpenAI stopped before completing the response (reason=${response.incomplete_details?.reason ?? "unknown"})`
      );
    }

    if (response.output_parsed === null) {
      throw new AiProviderError("OpenAI response contained no structured output");
    }

    return {
      data: response.output_parsed,
      estimatedCostUsd: estimateOpenAICost(modelId, response.usage ?? null),
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;

    if (error instanceof OpenAI.APIError) {
      throw new AiProviderError(`OpenAI returned HTTP ${error.status}: ${error.message}`, error.status);
    }

    const message = error instanceof Error ? error.message : "Network error";
    throw new AiProviderError(`OpenAI request failed: ${message}`);
  }
}
