import type { Json } from "@/db/database.types";
import type { SupabaseClientType } from "@/db/supabase.client";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { getRoundContextById } from "@/lib/services/rounds.service";
import type { AttemptDTO, CreateAttemptCommand } from "@/types";

interface AttemptInsertQuestionRow {
  id: string;
  question_text: string;
  difficulty_score: number;
  correct_answer: unknown;
}

function getCurrentActiveRoundId(rounds: { id: string; position: number; status: string }[]): string | null {
  const nextRound = [...rounds]
    .sort((left, right) => left.position - right.position)
    .find((round) => round.status !== "completed");
  return nextRound?.id ?? null;
}

export async function createAttempt(
  supabase: SupabaseClientType,
  userId: string,
  roundId: string,
  command: CreateAttemptCommand
): Promise<AttemptDTO> {
  const context = await getRoundContextById(supabase, userId, roundId);

  if (context.round.status !== "in_progress") {
    throw new BadRequestError("Attempts can only be recorded for an in-progress round.");
  }

  const activeRoundId = getCurrentActiveRoundId(context.sessionRounds);
  if (activeRoundId !== context.round.id) {
    throw new BadRequestError("Attempts can only be recorded for the current round.");
  }

  const expectedQuestionId = context.questionIds[command.position - 1];
  if (!expectedQuestionId) {
    throw new BadRequestError("Attempt position is outside the current round.");
  }

  if (command.question_id !== expectedQuestionId) {
    if (context.questionIds.includes(command.question_id)) {
      throw new BadRequestError("Question does not match the provided position.");
    }

    throw new NotFoundError("Question not found in this round.");
  }

  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("id, question_text, difficulty_score, correct_answer")
    .eq("id", command.question_id)
    .eq("user_id", userId)
    .single();

  if (questionError?.code === "PGRST116" || !question) {
    throw new NotFoundError("Question not found.");
  }

  if (questionError) {
    throw questionError;
  }

  const attemptPayload = {
    user_id: userId,
    session_id: context.sessionId,
    round_id: context.round.id,
    question_id: command.question_id,
    position: command.position,
    scratchpad: command.scratchpad ?? (command.timer_expired ? null : ""),
    time_taken_ms: command.time_taken_ms,
    timer_expired: command.timer_expired,
    verdict: null,
    is_flagged_by_user: false,
    flag_reason: null,
    question_text_snapshot: (question as AttemptInsertQuestionRow).question_text,
    difficulty_score_snapshot: (question as AttemptInsertQuestionRow).difficulty_score,
    correct_answer_snapshot: (question as AttemptInsertQuestionRow).correct_answer as Json,
  };

  const { data: attempt, error: insertError } = await supabase
    .from("attempts")
    .insert(attemptPayload)
    .select(
      "id, question_id, position, scratchpad, time_taken_ms, timer_expired, verdict, is_flagged_by_user, created_at"
    )
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new ConflictError("An attempt for this round position already exists.");
    }

    throw insertError;
  }

  return {
    id: attempt.id,
    question_id: attempt.question_id,
    position: attempt.position,
    scratchpad: attempt.scratchpad,
    time_taken_ms: attempt.time_taken_ms,
    timer_expired: attempt.timer_expired,
    verdict: attempt.verdict,
    is_flagged_by_user: attempt.is_flagged_by_user,
    created_at: attempt.created_at,
  };
}
