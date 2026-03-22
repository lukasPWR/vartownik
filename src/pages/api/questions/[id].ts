import type { APIRoute } from "astro";
import { z } from "zod";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { deleteQuestion, getQuestionById, updateQuestion } from "@/lib/services/questions.service";
import type { UpdateQuestionCommand } from "@/types";

export const prerender = false;

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const UpdateQuestionBodySchema = z.object({
  question_text: z.string().min(10).optional(),
  correct_answer: z
    .object({
      primary: z.string().min(1),
      synonyms: z.array(z.string()).optional(),
    })
    .optional(),
  difficulty_score: z.number().int().min(1).max(5).optional(),
  status: z.enum(["active", "flagged", "needs_review", "verified", "archived"]).optional(),
  category_ids: z.array(z.string().uuid()).optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  change_reason: z.string().min(1).max(500),
});

export const GET: APIRoute = async ({ locals, params }) => {
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
    const result = await getQuestionById(locals.supabase, TEST_USER_ID, parsed.data.id);
    return new Response(JSON.stringify(result), {
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
    console.error("[GET /api/questions/:id] Unexpected error", {
      userId: TEST_USER_ID,
      id: parsed.data.id,
      err,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  //   if (!locals.user) {
  //     return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //       status: 401,
  //       headers: { "Content-Type": "application/json" },
  //     });
  //   }

  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";

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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsedBody = UpdateQuestionBodySchema.safeParse(rawBody);
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
  const command = parsedBody.data as UpdateQuestionCommand;

  try {
    const result = await updateQuestion(locals.supabase, TEST_USER_ID, id, command);
    return new Response(JSON.stringify(result), {
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
    if (err instanceof Error) {
      const typedErr = err as Error & { code?: string };
      if (typedErr.code === "NO_FIELDS") {
        return new Response(JSON.stringify({ error: "No fields to update provided" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (typedErr.code === "INVALID_RELATION_IDS") {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    console.error("[PATCH /api/questions/:id] Unexpected error", {
      userId: TEST_USER_ID,
      id,
      err,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

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
    await deleteQuestion(locals.supabase, TEST_USER_ID, parsed.data.id);
    return new Response(null, { status: 204 });
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
    console.error("[DELETE /api/questions/:id] Unexpected error", {
      userId: TEST_USER_ID,
      id: parsed.data.id,
      err,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
