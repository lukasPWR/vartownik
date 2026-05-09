import type { APIRoute } from "astro";
import { z } from "zod";

import type { CategoryStatsResponseDTO, CategoryStatsItemDTO } from "@/types";

export const prerender = false;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD")
    .optional(),
});

// ---------------------------------------------------------------------------
// GET /api/stats/categories — per-category accuracy for the authenticated user
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

  const { from, to } = parsed.data;

  try {
    let query = locals.supabase
      .from("category_stats_daily")
      .select("category_id, knew_count, did_not_know_count, attempts_count, categories(name)")
      .eq("user_id", userId);

    if (from) query = query.gte("stat_date", from);
    if (to) query = query.lte("stat_date", to);

    const { data, error } = await query;

    if (error) throw error;

    // Aggregate daily rows into per-category totals
    const categoryMap = new Map<string, { name: string; knew: number; did_not_know: number; attempts: number }>();

    for (const row of data ?? []) {
      const categoryName = (row.categories as { name: string } | null)?.name ?? row.category_id;
      const existing = categoryMap.get(row.category_id);

      if (existing) {
        existing.knew += row.knew_count;
        existing.did_not_know += row.did_not_know_count;
        existing.attempts += row.attempts_count;
      } else {
        categoryMap.set(row.category_id, {
          name: categoryName,
          knew: row.knew_count,
          did_not_know: row.did_not_know_count,
          attempts: row.attempts_count,
        });
      }
    }

    const items: CategoryStatsItemDTO[] = Array.from(categoryMap.entries()).map(([id, stats]) => {
      const scored = stats.knew + stats.did_not_know;
      return {
        category_id: id,
        category_name: stats.name,
        attempts_count: stats.attempts,
        knew_count: stats.knew,
        did_not_know_count: stats.did_not_know,
        accuracy_percent: scored > 0 ? Math.round((stats.knew / scored) * 1000) / 10 : 0,
      };
    });

    const result: CategoryStatsResponseDTO = { data: items };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/stats/categories]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
