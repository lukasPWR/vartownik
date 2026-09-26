import { z } from "zod";

export const QUESTION_STATUSES = ["active", "flagged", "verified", "archived"] as const;
export const QuestionStatusSchema = z.enum(QUESTION_STATUSES);
export type CanonicalQuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const ELIGIBLE_QUESTION_STATUSES = ["active", "verified"] as const;

const transitions: Record<CanonicalQuestionStatus, readonly CanonicalQuestionStatus[]> = {
  active: ["flagged", "archived"],
  flagged: ["verified", "archived"],
  verified: ["flagged", "archived"],
  archived: ["active"],
};

export function canTransitionQuestionStatus(from: CanonicalQuestionStatus, to: CanonicalQuestionStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function isEligibleQuestionStatus(status: string): boolean {
  return (ELIGIBLE_QUESTION_STATUSES as readonly string[]).includes(status);
}
