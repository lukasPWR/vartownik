import type { APIRoute } from "astro";
import { z } from "zod";

import { BadRequestError, NotFoundError, UnprocessableEntityError } from "@/lib/errors";
import { getRoundByPosition } from "@/lib/services/rounds.service";

export const prerender = false;

const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  position: z.coerce.number().int().min(1).max(4),
});

export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const round = await getRoundByPosition(
      locals.supabase,
      locals.user.id,
      parsed.data.sessionId,
      parsed.data.position
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

    if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("[GET /api/sessions/:sessionId/rounds/:position]", {
      userId: locals.user.id,
      sessionId: parsed.data.sessionId,
      position: parsed.data.position,
      err,
    });

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
