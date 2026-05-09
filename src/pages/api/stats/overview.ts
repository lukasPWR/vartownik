import type { APIRoute } from "astro";

import type { StatsOverviewDTO } from "@/types";

export const prerender = false;

// ---------------------------------------------------------------------------
// GET /api/stats/overview — aggregated stats for the authenticated user
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = locals.user.id;

  try {
    const [totalResult, knewResult, didNotKnowResult, sessionsResult, flaggedResult] = await Promise.all([
      // Total attempts count
      locals.supabase.from("attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),

      // Knew count
      locals.supabase
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("verdict", "knew"),

      // Did not know count
      locals.supabase
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("verdict", "did_not_know"),

      // Completed sessions count
      locals.supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "completed"),

      // Flagged questions pending review
      locals.supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "flagged"),
    ]);

    for (const result of [totalResult, knewResult, didNotKnowResult, sessionsResult, flaggedResult]) {
      if (result.error) throw result.error;
    }

    const knew_count = knewResult.count ?? 0;
    const did_not_know_count = didNotKnowResult.count ?? 0;
    const scored_count = knew_count + did_not_know_count;
    const raw_accuracy = scored_count > 0 ? (knew_count / scored_count) * 100 : 0;

    const overview: StatsOverviewDTO = {
      total_attempts: totalResult.count ?? 0,
      knew_count,
      did_not_know_count,
      overall_accuracy_percent: Math.round(raw_accuracy * 10) / 10,
      total_sessions_completed: sessionsResult.count ?? 0,
      flagged_questions_pending: flaggedResult.count ?? 0,
    };

    return new Response(JSON.stringify(overview), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/stats/overview]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
