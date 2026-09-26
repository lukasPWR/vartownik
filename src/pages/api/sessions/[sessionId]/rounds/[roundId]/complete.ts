import type { APIRoute } from "astro";
import { z } from "zod";

import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { completeRound } from "@/lib/services/rounds.service";

export const prerender = false;

const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  roundId: z.string().uuid(),
});

export const POST: APIRoute = async ({ locals, params }) => {
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

  try {
    const round = await completeRound(
      locals.supabase,
      locals.user.id,
      parsedParams.data.sessionId,
      parsedParams.data.roundId
    );

    return new Response(JSON.stringify(round), {
      status: 200,
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

    console.error("[POST /api/sessions/:sessionId/rounds/:roundId/complete]", {
      userId: locals.user.id,
      sessionId: parsedParams.data.sessionId,
      roundId: parsedParams.data.roundId,
      err,
    });

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
