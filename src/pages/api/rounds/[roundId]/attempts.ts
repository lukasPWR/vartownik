import type { APIRoute } from "astro";
import { z } from "zod";

import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { createAttempt } from "@/lib/services/attempts.service";

export const prerender = false;

const ParamsSchema = z.object({
  roundId: z.string().uuid(),
});

const CreateAttemptSchema = z.object({
  question_id: z.string().uuid(),
  position: z.number().int().min(1).max(10),
  scratchpad: z.string().max(10_000).nullable().optional(),
  time_taken_ms: z.number().int().min(0),
  timer_expired: z.boolean(),
});

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsedParams.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsedBody = CreateAttemptSchema.safeParse(body);
  if (!parsedBody.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsedBody.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const attempt = await createAttempt(locals.supabase, locals.user.id, parsedParams.data.roundId, parsedBody.data);
    return new Response(JSON.stringify(attempt), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (err instanceof ConflictError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (err instanceof BadRequestError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("[POST /api/rounds/:roundId/attempts]", {
      userId: locals.user.id,
      roundId: parsedParams.data.roundId,
      err,
    });

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
