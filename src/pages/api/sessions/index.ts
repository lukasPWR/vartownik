import type { APIRoute } from "astro";
import { z } from "zod";

import { createSession, listSessions } from "@/lib/services/sessions.service";
import { BatchNotFoundError, BatchNotSuccessError, UnprocessableEntityError } from "@/lib/errors";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["in_progress", "completed", "abandoned"]).optional(),
});

const CreateSessionSchema = z.object({
  generation_batch_id: z.string().uuid(),
  timer_seconds: z.number().int().min(15).max(30).default(20),
});

// ---------------------------------------------------------------------------
// GET /api/sessions — paginated list of sessions for the authenticated user
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = locals.user.id;
  const { searchParams } = new URL(request.url);

  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { page, limit, status } = parsed.data;

  try {
    const result = await listSessions(locals.supabase, userId, { page, limit, status });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/sessions]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------------------
// POST /api/sessions — create a new training session
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = locals.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = CreateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const result = await createSession(parsed.data, userId, locals.supabase);
    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof BatchNotFoundError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (err instanceof BatchNotSuccessError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (err instanceof UnprocessableEntityError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[POST /api/sessions]", { userId, err });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
