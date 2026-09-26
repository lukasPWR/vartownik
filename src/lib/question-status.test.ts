import { describe, expect, it, vi } from "vitest";

import { canTransitionQuestionStatus, isEligibleQuestionStatus, QuestionStatusSchema } from "@/lib/question-status";
import { ConflictError } from "@/lib/errors";
import { updateQuestion } from "@/lib/services/questions.service";

const userId = "ae000000-0000-4000-8000-000000000001";
const questionId = "ae000000-0000-4000-8000-000000000002";

function questionClient(status: "active" | "flagged" | "verified" | "archived") {
  const row = {
    id: questionId,
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
  };
  const update = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
  const audit = vi.fn(async () => ({ error: null }));
  const client = {
    from(table: string) {
      if (table === "questions")
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ order: () => ({ single: async () => ({ data: row, error: null }) }) }) }),
          }),
          update,
        };
      if (table === "question_edits") return { insert: audit };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return { client: client as never, update, audit };
}

describe("canonical question statuses", () => {
  it("rejects the legacy alias and only admits active or verified to selection", () => {
    expect(QuestionStatusSchema.safeParse("needs_review").success).toBe(false);
    expect(["active", "flagged", "verified", "archived"].filter(isEligibleQuestionStatus)).toEqual([
      "active",
      "verified",
    ]);
  });

  it("allows the documented transitions and idempotence", () => {
    expect(canTransitionQuestionStatus("flagged", "verified")).toBe(true);
    expect(canTransitionQuestionStatus("archived", "active")).toBe(true);
    expect(canTransitionQuestionStatus("verified", "flagged")).toBe(true);
    expect(canTransitionQuestionStatus("flagged", "active")).toBe(false);
    expect(canTransitionQuestionStatus("active", "verified")).toBe(false);
    expect(canTransitionQuestionStatus("flagged", "flagged")).toBe(true);
  });
});

describe("question status service", () => {
  it("rejects invalid transitions before writing", async () => {
    const { client, update, audit } = questionClient("flagged");
    await expect(
      updateQuestion(client, userId, questionId, { status: "active", change_reason: "restore" })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("keeps resolution separate from editing and records a reason", async () => {
    const { client, update, audit } = questionClient("flagged");
    await expect(
      updateQuestion(client, userId, questionId, {
        status: "verified",
        question_text: "Corrected text",
        change_reason: "fixed",
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await updateQuestion(client, userId, questionId, { status: "verified", change_reason: "false alarm" });
    expect(update).toHaveBeenCalledWith({ status: "verified" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ change_reason: "false alarm" }));
  });
});
