import type { APIRoute } from "astro";
import { z } from "zod";

import { ConflictError } from "@/lib/errors";
import { createTag, listTags } from "@/lib/services/tags.service";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const CreateTagBodySchema = z.object({
  name: z.string().min(1).max(50),
});

// ---------------------------------------------------------------------------
// GET /api/tags — all tags for the authenticated user
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals }) => {
  //   if (!locals.user) {
  //     return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //       status: 401,
  //       headers: { "Content-Type": "application/json" },
  //     });
  //   }

  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";

  try {
    const result = await listTags(locals.supabase);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/tags]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------------------
// POST /api/tags — create a new tag for the authenticated user
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ locals, request }) => {
  //   if (!locals.user) {
  //     return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //       status: 401,
  //       headers: { "Content-Type": "application/json" },
  //     });
  //   }

  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = CreateTagBodySchema.safeParse(body);
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
    const tag = await createTag(locals.supabase, TEST_USER_ID, parsed.data);
    return new Response(JSON.stringify(tag), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[POST /api/tags]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
