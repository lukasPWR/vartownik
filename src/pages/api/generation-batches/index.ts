import type { APIRoute } from "astro";
import { z } from "zod";

import {
  createGenerationBatch,
  listGenerationBatches,
  ListGenerationBatchesQuerySchema,
} from "@/lib/services/generation-batch.service";
import {
  AiParseError,
  AiProviderError,
  ConflictError,
  GenerationAdmissionError,
  GenerationBudgetExceededError,
  GenerationCancelledError,
  GenerationDeadlineError,
  GenerationPersistenceError,
  RateLimitError,
} from "@/lib/errors";

export const prerender = false;

const JSON_HEADERS = { "Content-Type": "application/json" };

const CreateGenerationBatchSchema = z
  .object({
    model: z.literal("gpt-6-luna"),
    provider: z.literal("openai"),
    prompt_version: z.literal("v1"),
    requested_questions_count: z.literal(40),
  })
  .strict();

const IdempotencyKeySchema = z.string().uuid();

type CreateGenerationBatch = typeof createGenerationBatch;

export interface GenerationBatchPostDependencies {
  createBatch?: CreateGenerationBatch;
}

function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function errorResponse(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return jsonResponse(status, { error: { code, message } }, headers);
}

function mapGenerationError(error: unknown): Response | null {
  if (error instanceof ConflictError) {
    return errorResponse(409, "conflict", error.message);
  }

  if (error instanceof GenerationAdmissionError) {
    return errorResponse(400, error.code, error.message);
  }

  if (error instanceof GenerationBudgetExceededError) {
    return errorResponse(422, error.code, error.message);
  }

  if (error instanceof GenerationDeadlineError) {
    return errorResponse(504, error.code, error.message);
  }

  if (error instanceof GenerationCancelledError) {
    return errorResponse(408, error.code, error.message);
  }

  if (error instanceof GenerationPersistenceError) {
    return errorResponse(503, error.code, error.message);
  }

  if (error instanceof RateLimitError) {
    return errorResponse(429, "rate_limit", error.message, { "Retry-After": String(10 * 60) });
  }

  if (error instanceof AiParseError) {
    return errorResponse(422, "parse_failed", error.message);
  }

  if (error instanceof AiProviderError) {
    return errorResponse(error.statusCode === 429 ? 429 : 502, "provider_failed", "AI provider request failed.");
  }

  return null;
}

/**
 * Builds the POST handler around an injectable service boundary. Production
 * uses the real lifecycle service; tests can prove admission ordering without
 * loading Supabase or a provider.
 */
export function createGenerationBatchPostHandler(dependencies: GenerationBatchPostDependencies = {}): APIRoute {
  const createBatch = dependencies.createBatch ?? createGenerationBatch;

  return async ({ locals, request }) => {
    if (!locals.user) {
      return errorResponse(401, "unauthorized", "Unauthorized");
    }

    const parsedKey = IdempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!parsedKey.success) {
      return errorResponse(400, "invalid_idempotency_key", "Idempotency-Key must be a valid UUID.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
    }

    const parsed = CreateGenerationBatchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(400, {
        error: {
          code: "validation_failed",
          message: "Validation failed.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }

    try {
      const result = await createBatch(parsed.data, locals.user.id, locals.supabase, {
        idempotencyKey: parsedKey.data,
        signal: request.signal,
      });

      return jsonResponse(result.status === "pending" ? 201 : 202, result);
    } catch (error) {
      const mapped = mapGenerationError(error);
      if (mapped) return mapped;

      console.error("[POST /api/generation-batches] Unexpected error", {
        userId: locals.user.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return errorResponse(500, "internal_error", "Internal server error");
    }
  };
}

export const POST: APIRoute = createGenerationBatchPostHandler();

// ---------------------------------------------------------------------------
// GET /api/generation-batches - paginated list for the authenticated user
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return errorResponse(401, "unauthorized", "Unauthorized");
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = ListGenerationBatchesQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return jsonResponse(400, {
      error: {
        code: "validation_failed",
        message: "Validation failed.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  try {
    const result = await listGenerationBatches(locals.supabase, parsed.data, locals.user.id);
    return jsonResponse(200, result);
  } catch (error) {
    console.error("[GET /api/generation-batches] Unexpected error", {
      userId: locals.user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(500, "internal_error", "Internal server error");
  }
};
