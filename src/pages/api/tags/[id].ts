import type { APIRoute } from "astro";
import { z } from "zod";

import { NotFoundError } from "@/lib/errors";
import { deleteTag } from "@/lib/services/tags.service";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// DELETE /api/tags/:id — delete a tag owned by the authenticated user
// ---------------------------------------------------------------------------

export const DELETE: APIRoute = async ({ locals, params }) => {
  //   if (!locals.user) {
  //     return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //       status: 401,
  //       headers: { "Content-Type": "application/json" },
  //     });
  //   }
  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";
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

  try {
    await deleteTag(locals.supabase, TEST_USER_ID, parsed.data.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[DELETE /api/tags/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
