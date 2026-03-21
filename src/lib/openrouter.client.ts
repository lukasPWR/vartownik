import { OPENROUTER_API_KEY } from "astro:env/server";
import { OpenRouterError } from "@/lib/errors";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Calls the OpenRouter chat completions API with the provided messages.
 * Throws `OpenRouterError` on non-2xx responses or network failures.
 * Enforces a hard 60-second request timeout.
 */
export async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[]
): Promise<{ content: string; estimatedCostUsd: number | null }> {
  let response: Response;

  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vartownik.app",
        "X-Title": "VARtownik Quiz Generator",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new OpenRouterError(`OpenRouter request failed: ${message}`);
  }

  if (!response.ok) {
    throw new OpenRouterError(`OpenRouter returned HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  let data: OpenRouterResponse;
  try {
    data = (await response.json()) as OpenRouterResponse;
  } catch {
    throw new OpenRouterError("OpenRouter returned a non-JSON response");
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new OpenRouterError("OpenRouter response contained no message content");
  }

  // Rough cost estimation: not all models expose usage, so null is acceptable
  const estimatedCostUsd = data.usage ? estimateCost(model, data.usage.total_tokens) : null;

  return { content, estimatedCostUsd };
}

/**
 * Very rough cost estimate based on token usage.
 * Values are approximate — for display only, not billing-critical.
 */
function estimateCost(model: string, totalTokens: number): number {
  // Approximate blended cost per 1M tokens in USD (input+output average, conservative upper estimate)
  // Source: OpenRouter pricing — values are approximate and for display only
  const COST_PER_MILLION: Record<string, number> = {
    // Google Gemini
    "google/gemini-2.5-pro": 3.5,
    "google/gemini-2.0-flash": 0.15,
    "google/gemini-2.0-flash-lite": 0.075,
    "google/gemini-1.5-pro": 1.75,
    "google/gemini-1.5-flash": 0.15,
    "google/gemini-1.5-flash-8b": 0.075,
  };

  const ratePerMillion = COST_PER_MILLION[model] ?? 2.0;
  return parseFloat(((totalTokens / 1_000_000) * ratePerMillion).toFixed(6));
}
