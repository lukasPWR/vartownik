import type { APIRoute } from "astro";
import { z } from "zod";

import { createClient } from "@/lib/supabase";
import { createGenerationBatch } from "@/lib/services/generation-batch.service";
import { AiParseError, OpenRouterError, RateLimitError } from "@/lib/errors";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const CreateGenerationBatchSchema = z.object({
  model: z.string().min(1).max(100),
  provider: z.enum(["openrouter", "google"]),
  prompt_version: z.string().regex(/^v\d+$/, "prompt_version must match pattern v<number> (e.g. v1)"),
  requested_questions_count: z.number().int().positive().max(200).default(40),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST: APIRoute = async (context) => {
  const { locals, request, cookies } = context;

  // AUTH DISABLED FOR TESTING — restore before production
  // if (!locals.user) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //     status: 401,
  //     headers: { "Content-Type": "application/json" },
  //   });
  // }
  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = CreateGenerationBatchSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const command = parsed.data;

  // Use SSR Supabase client (cookie-based session) for user-scoped operations
  const supabase = createClient(request.headers, cookies);

  try {
    const result = await createGenerationBatch(command, locals.user?.id ?? TEST_USER_ID, supabase);

    return new Response(JSON.stringify(result), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(10 * 60), // 10 minutes in seconds
        },
      });
    }

    if (error instanceof AiParseError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (error instanceof OpenRouterError) {
      // TODO: restore generic message before production
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.statusCode === 429 ? 429 : 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Unexpected error — log with context but don't leak internals
    console.error("[POST /api/generation-batches] Unexpected error", {
      userId: locals.user?.id ?? TEST_USER_ID,
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
