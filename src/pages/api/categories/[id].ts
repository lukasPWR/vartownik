import type { APIRoute } from "astro";
import { z } from "zod";

import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  getCategoryById,
  updateCategory,
  UpdateCategoryBodySchema,
  deleteCategory,
} from "@/lib/services/categories.service";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// GET /api/categories/:id — single category for the authenticated user
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals, params }) => {
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

  //   if (!locals.user) {
  //     return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //       status: 401,
  //       headers: { "Content-Type": "application/json" },
  //     });
  //   }

  try {
    const category = await getCategoryById(locals.supabase, parsed.data.id);
    return new Response(JSON.stringify(category), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Category not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[GET /api/categories/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/categories/:id — partial update of a category
// ---------------------------------------------------------------------------

export const PATCH: APIRoute = async ({ locals, params, request }) => {
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
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsedBody = UpdateCategoryBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsedBody.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const category = await updateCategory(locals.supabase, parsedParams.data.id, parsedBody.data);
    return new Response(JSON.stringify(category), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Category not found" }), {
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
    console.error("[PATCH /api/categories/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/categories/:id — delete category and its question associations
// ---------------------------------------------------------------------------

export const DELETE: APIRoute = async ({ locals, params }) => {
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

  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await deleteCategory(locals.supabase, parsed.data.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Category not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[DELETE /api/categories/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
