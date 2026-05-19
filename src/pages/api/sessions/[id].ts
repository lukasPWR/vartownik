import type { APIRoute } from "astro";
import { z } from "zod";

import { BadRequestError, NotFoundError } from "@/lib/errors";
import { abandonSession, getSessionById } from "@/lib/services/sessions.service";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const PatchBodySchema = z.object({
  status: z.literal("abandoned"),
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id — full details of a single session
// ---------------------------------------------------------------------------

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
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { id } = parsed.data;

  try {
    const session = await getSessionById(locals.supabase, id);
    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("[GET /api/sessions/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/sessions/:id — abandon an in_progress session
// ---------------------------------------------------------------------------

export const PATCH: APIRoute = async ({ locals, params, request }) => {
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
        issues: parsedParams.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Validation failed", issues: [{ path: "", message: "Invalid JSON body" }] }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const parsedBody = PatchBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsedBody.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { id } = parsedParams.data;

  try {
    const session = await abandonSession(locals.supabase, id, locals.user.id);
    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (err instanceof BadRequestError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("[PATCH /api/sessions/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
