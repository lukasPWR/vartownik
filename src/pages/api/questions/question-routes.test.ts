import { describe, expect, it } from "vitest";

import { GET as list, POST as create } from "./index";
import { DELETE as remove, GET as detail, PATCH as update } from "./[id]";

const id = "ae000000-0000-4000-8000-000000000002";
const userId = "ae000000-0000-4000-8000-000000000001";
const url = new URL("http://localhost/api/questions");

function context(user: { id: string } | null, request = new Request(url), params = { id }, status?: string) {
  const row = status
    ? {
        id,
        generated_type: "manual",
        status,
        question_text: "Question text",
        correct_answer: { primary: "answer", synonyms: [] },
        difficulty_score: 2,
        image_path: null,
        source_model: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        question_categories: [],
        question_tags: [],
        question_edits: [],
      }
    : null;
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({ single: async () => ({ data: row, error: row ? null : { code: "PGRST116" } }) }),
          }),
        }),
      }),
    }),
  };
  return { locals: { user, supabase }, request, params, url: new URL(request.url) } as never;
}

describe("question routes", () => {
  it("requires authentication on every method", async () => {
    for (const handler of [list, create, detail, update, remove]) {
      const response = await handler(context(null));
      expect(response.status).toBe(401);
    }
  });

  it("hides a question absent from the authenticated owner's scope", async () => {
    const response = await detail(context({ id: userId }));
    expect(response.status).toBe(404);
  });

  it("rejects the legacy alias in list and write requests", async () => {
    const listResponse = await list(context({ id: userId }, new Request(`${url}?status=needs_review`)));
    expect(listResponse.status).toBe(400);
    const patchResponse = await update(
      context(
        { id: userId },
        new Request(`${url}/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "needs_review", change_reason: "old alias" }),
        })
      )
    );
    expect(patchResponse.status).toBe(400);
  });

  it("maps an invalid transition to conflict", async () => {
    const request = new Request(`${url}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", change_reason: "invalid restore" }),
    });
    const response = await update(context({ id: userId }, request, { id }, "flagged"));
    expect(response.status).toBe(409);
  });
});
