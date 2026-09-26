import { describe, expect, it } from "vitest";

import { GET as listQuestions } from "./index";
import { GET as overview } from "../stats/overview";
import type { ListQuestionsResponseDTO, StatsOverviewDTO } from "@/types";

const ownerId = "owner-1";

interface Row {
  id: string;
  user_id: string;
  status: string;
  question_text: string;
  created_at: string;
  generated_type: "manual";
  correct_answer: { primary: string; synonyms: string[] };
  difficulty_score: number;
  image_path: null;
  source_model: null;
  question_categories: [];
  question_tags: [];
}

function question(id: string, status: string, user_id = ownerId): Row {
  return {
    id,
    user_id,
    status,
    question_text: `Question ${id}`,
    created_at: `2026-01-${id.padStart(2, "0")}`,
    generated_type: "manual",
    correct_answer: { primary: "answer", synonyms: [] },
    difficulty_score: 2,
    image_path: null,
    source_model: null,
    question_categories: [],
    question_tags: [],
  };
}

function client(rows: Row[]) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let countOnly = false;
      let start = 0;
      let end = Number.POSITIVE_INFINITY;
      let sortAscending = false;
      const query = {
        select(_columns: string, options?: { head?: boolean }) {
          countOnly = options?.head ?? false;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        order(_column: string, options: { ascending: boolean }) {
          sortAscending = options.ascending;
          return query;
        },
        range(from: number, to: number) {
          start = from;
          end = to + 1;
          return query;
        },
        then(resolve: (result: { data: Row[] | null; count: number; error: null }) => void) {
          const matching = (table === "questions" ? rows : [])
            .filter((row) => filters.every(([column, value]) => row[column as keyof Row] === value))
            .sort((a, b) =>
              sortAscending ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)
            );
          resolve({ data: countOnly ? null : matching.slice(start, end), count: matching.length, error: null });
        },
      };
      return query;
    },
  };
}

function context(supabase: ReturnType<typeof client>, path: string) {
  return { locals: { user: { id: ownerId }, supabase }, url: new URL(`http://localhost${path}`) } as never;
}

describe("pending review reads", () => {
  it("matches the full owner-scoped flagged count across paginated list and overview", async () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) => question(String(index + 1), "flagged")),
      question("7", "flagged"), // Represents a needs_review row normalized by the migration.
      question("8", "verified"),
      question("9", "archived"),
      question("10", "flagged", "another-owner"),
    ];
    const supabase = client(rows);

    const first = await listQuestions(context(supabase, "/api/questions?status=flagged&page=1&limit=5"));
    const second = await listQuestions(context(supabase, "/api/questions?status=flagged&page=2&limit=5"));
    const stats = await overview(context(supabase, "/api/stats/overview"));

    expect([first.status, second.status, stats.status]).toEqual([200, 200, 200]);
    const firstBody = (await first.json()) as ListQuestionsResponseDTO;
    const secondBody = (await second.json()) as ListQuestionsResponseDTO;
    const statsBody = (await stats.json()) as StatsOverviewDTO;
    expect(firstBody.data).toHaveLength(5);
    expect(secondBody.data).toHaveLength(2);
    expect(firstBody.pagination.total).toBe(7);
    expect(secondBody.pagination.total).toBe(7);
    expect(statsBody.flagged_questions_pending).toBe(7);
    expect([...firstBody.data, ...secondBody.data].map((row) => row.id).sort()).toEqual(
      Array.from({ length: 7 }, (_, index) => String(index + 1)).sort()
    );

    const migratedQuestion = rows.find((row) => row.id === "7");
    if (!migratedQuestion) throw new Error("Missing migrated question fixture");
    migratedQuestion.status = "verified";
    const afterResolution = await overview(context(supabase, "/api/stats/overview"));
    expect(((await afterResolution.json()) as StatsOverviewDTO).flagged_questions_pending).toBe(6);
    const listAfterResolution = await listQuestions(context(supabase, "/api/questions?status=flagged&limit=5"));
    expect(((await listAfterResolution.json()) as ListQuestionsResponseDTO).pagination.total).toBe(6);
  });
});
