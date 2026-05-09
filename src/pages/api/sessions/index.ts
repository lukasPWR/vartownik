import type { APIRoute } from "astro";
import { z } from "zod";

import type { SessionListItemDTO, SessionsResponseDTO, ScoreSummaryDTO } from "@/types";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["in_progress", "completed", "abandoned"]).optional(),
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
  const offset = (page - 1) * limit;

  try {
    let query = locals.supabase
      .from("sessions")
      .select(
        `id, status, timer_seconds, total_rounds, questions_per_round, started_at, completed_at,
         rounds(attempts(verdict))`,
        { count: "exact" }
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;

    if (error) throw error;

    const items: SessionListItemDTO[] = (data ?? []).map((session) => {
      // Flatten all attempts from all rounds
      const allAttempts = (session.rounds as { attempts: { verdict: string | null }[] }[]).flatMap((r) => r.attempts);

      const total_questions = allAttempts.length;
      const knew_count = allAttempts.filter((a) => a.verdict === "knew").length;
      const did_not_know_count = allAttempts.filter((a) => a.verdict === "did_not_know").length;
      const scored = knew_count + did_not_know_count;

      const score_summary: ScoreSummaryDTO | null =
        total_questions > 0
          ? {
              total_questions,
              knew_count,
              did_not_know_count,
              accuracy_percent: scored > 0 ? Math.round((knew_count / scored) * 1000) / 10 : 0,
            }
          : null;

      return {
        id: session.id,
        status: session.status,
        timer_seconds: session.timer_seconds,
        total_rounds: session.total_rounds,
        questions_per_round: session.questions_per_round,
        started_at: session.started_at,
        completed_at: session.completed_at,
        score_summary,
      };
    });

    const result: SessionsResponseDTO = {
      data: items,
      pagination: { page, limit, total: count ?? 0 },
    };

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
