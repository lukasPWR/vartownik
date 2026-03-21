import type { APIRoute } from "astro";
import { z } from "zod";

import { listQuestions } from "@/lib/services/questions.service";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const ListQuestionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["active", "flagged", "needs_review", "verified", "archived"]).optional(),
  generated_type: z.enum(["manual", "ai"]).optional(),
  category_id: z.string().uuid().optional(),
  tag_id: z.string().uuid().optional(),
  difficulty_score: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["created_at_desc", "created_at_asc", "difficulty_asc", "difficulty_desc"]).default("created_at_desc"),
});

export type ListQuestionsQuery = z.infer<typeof ListQuestionsSchema>;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals, url }) => {
  // AUTH DISABLED FOR TESTING — restore before production
  // if (!locals.user) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //     status: 401,
  //     headers: { "Content-Type": "application/json" },
  //   });
  // }
  const TEST_USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";
  const userId = locals.user?.id ?? TEST_USER_ID;

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = ListQuestionsSchema.safeParse(rawParams);

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
    const result = await listQuestions(locals.supabase, userId, parsed.data);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/questions] DB error", { userId, err });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
