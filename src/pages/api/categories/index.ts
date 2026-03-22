import type { APIRoute } from "astro";
import { z } from "zod";

import { ConflictError } from "@/lib/errors";
import { createCategory, listCategories, ListCategoriesQuerySchema } from "@/lib/services/categories.service";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const CreateCategoryBodySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/categories — paginated list of categories for the authenticated user
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals, request }) => {
  // if (!locals.user) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //     status: 401,
  //     headers: { "Content-Type": "application/json" },
  //   });
  // }

  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";
  const userId = locals.user?.id ?? TEST_USER_ID;

  const { searchParams } = new URL(request.url);
  const rawQuery = Object.fromEntries(searchParams.entries());

  const parsed = ListCategoriesQuerySchema.safeParse(rawQuery);
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
    const result = await listCategories(locals.supabase, parsed.data);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/categories]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------------------
// POST /api/categories — create a new category
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

  const parsed = CreateCategoryBodySchema.safeParse(body);
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
    const category = await createCategory(locals.supabase, locals.user?.id ?? TEST_USER_ID, parsed.data);
    return new Response(JSON.stringify(category), {
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
    console.error("[POST /api/categories]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
