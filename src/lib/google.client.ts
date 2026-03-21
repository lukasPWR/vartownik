import { GOOGLE_API_KEY } from "astro:env/server";
import { OpenRouterError } from "@/lib/errors";
import type { OpenRouterMessage } from "@/lib/openrouter.client";

const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 60_000;

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: GeminiPart[];
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Calls the Google Gemini generateContent API.
 * Accepts the same `OpenRouterMessage[]` format as callOpenRouter for interoperability.
 * Maps `system` role messages to Gemini's `systemInstruction` field.
 * Throws `OpenRouterError` on non-2xx responses or network failures.
 */
export async function callGoogle(
  model: string,
  messages: OpenRouterMessage[]
): Promise<{ content: string; estimatedCostUsd: number | null }> {
  // Gemini separates system instruction from conversation turns
  const systemMessage = messages.find((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  const contents: GeminiContent[] = conversationMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };

  if (systemMessage) {
    body.systemInstruction = { parts: [{ text: systemMessage.content }] };
  }

  // Strip provider prefix if present (e.g. "google/gemini-2.0-flash" → "gemini-2.0-flash")
  const modelId = model.startsWith("google/") ? model.slice("google/".length) : model;
  const url = `${GOOGLE_API_BASE}/${modelId}:generateContent?key=${GOOGLE_API_KEY}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new OpenRouterError(`Google Gemini request failed: ${message}`);
  }

  if (!response.ok) {
    throw new OpenRouterError(
      `Google Gemini returned HTTP ${response.status}: ${response.statusText}`,
      response.status
    );
  }

  let data: GeminiResponse;
  try {
    data = (await response.json()) as GeminiResponse;
  } catch {
    throw new OpenRouterError("Google Gemini returned a non-JSON response");
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new OpenRouterError("Google Gemini response contained no text content");
  }

  const estimatedCostUsd = data.usageMetadata ? estimateGeminiCost(modelId, data.usageMetadata.totalTokenCount) : null;

  return { content, estimatedCostUsd };
}

function estimateGeminiCost(modelId: string, totalTokens: number): number {
  // Approximate blended cost per 1M tokens in USD
  const COST_PER_MILLION: Record<string, number> = {
    "gemini-2.5-pro": 3.5,
    "gemini-2.0-flash": 0.15,
    "gemini-2.0-flash-lite": 0.075,
    "gemini-1.5-pro": 1.75,
    "gemini-1.5-flash": 0.15,
    "gemini-1.5-flash-8b": 0.075,
  };

  const ratePerMillion = COST_PER_MILLION[modelId] ?? 1.0;
  return parseFloat(((totalTokens / 1_000_000) * ratePerMillion).toFixed(6));
}
