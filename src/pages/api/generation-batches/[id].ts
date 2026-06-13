import type { APIRoute } from "astro";
import { z } from "zod";

import { createClient } from "@/lib/supabase";
import { getGenerationBatchById } from "@/lib/services/generation-batch.service";
import { NotFoundError } from "@/lib/errors";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const ParamsSchema = z.object({
  id: z.string().uuid("Batch id must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET: APIRoute = async (context) => {
  const { locals, params, request, cookies } = context;

  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = locals.user.id;

  // Validate path param
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = parsed.data;

  const supabase = createClient(request.headers, cookies);

  try {
    const batch = await getGenerationBatchById(supabase, id, userId);

    return new Response(JSON.stringify(batch), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Generation batch not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("[GET /api/generation-batches/:id] Unexpected error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
