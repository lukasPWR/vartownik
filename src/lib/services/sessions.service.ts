import type { SupabaseClientType } from "@/db/supabase.client";
import { z } from "zod";

import {
  BadRequestError,
  BatchNotFoundError,
  BatchNotSuccessError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/lib/errors";
import type {
  CreateSessionCommand,
  RoundSummaryDTO,
  RoundQuestionGroupDTO,
  ScoreSummaryDTO,
  SessionCreatedDTO,
  SessionDetailDTO,
  SessionListItemDTO,
  SessionsResponseDTO,
  SessionStatus,
} from "@/types";

const SESSION_TOTAL_ROUNDS = 4;
const SESSION_QUESTIONS_PER_ROUND = 10;

const BatchRoundSchema = z.object({
  position: z.number().int().positive(),
  question_ids: z.array(z.string().uuid()),
});

const BatchResponsePayloadSchema = z.object({
  rounds: z.array(BatchRoundSchema).length(SESSION_TOTAL_ROUNDS),
});

function validateBatchRoundsPayload(payload: unknown): RoundQuestionGroupDTO[] {
  const parsed = BatchResponsePayloadSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UnprocessableEntityError("Generation batch is missing a complete rounds mapping.");
  }

  const positions = parsed.data.rounds.map((round) => round.position).sort((left, right) => left - right);
  const expectedPositions = Array.from({ length: SESSION_TOTAL_ROUNDS }, (_, index) => index + 1);

  const hasExpectedPositions = positions.every((position, index) => position === expectedPositions[index]);
  const hasExpectedQuestionCount = parsed.data.rounds.every(
    (round) => round.question_ids.length === SESSION_QUESTIONS_PER_ROUND
  );
  const hasUniqueQuestionIds = parsed.data.rounds.every(
    (round) => new Set(round.question_ids).size === round.question_ids.length
  );

  if (!hasExpectedPositions || !hasExpectedQuestionCount || !hasUniqueQuestionIds) {
    throw new UnprocessableEntityError("Generation batch rounds mapping is incomplete or inconsistent.");
  }

  return parsed.data.rounds.sort((left, right) => left.position - right.position);
}

// ---------------------------------------------------------------------------
// List sessions
// ---------------------------------------------------------------------------

interface ListSessionsQuery {
  page: number;
  limit: number;
  status?: SessionStatus;
}

/**
 * Returns a paginated list of sessions for the given user.
 *
 * Fetches sessions with nested rounds → attempts to calculate score summaries
 * in a single query (no N+1). Applies optional status filter and cursor-free
 * offset pagination sorted by `started_at DESC`.
 */
export async function listSessions(
  supabase: SupabaseClientType,
  userId: string,
  query: ListSessionsQuery
): Promise<SessionsResponseDTO> {
  const { page, limit, status } = query;
  const offset = (page - 1) * limit;

  let dbQuery = supabase
    .from("sessions")
    .select(
      `id, status, timer_seconds, total_rounds, questions_per_round, started_at, completed_at,
       rounds(attempts(verdict))`,
      { count: "exact" }
    )
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) dbQuery = dbQuery.eq("status", status);

  const { data, error, count } = await dbQuery;

  if (error) throw error;

  const items: SessionListItemDTO[] = (data ?? []).map((session) => {
    // Flatten all attempts across all rounds to compute score summary
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
            // 1 decimal place: round((knew / scored) * 1000) / 10
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

  return {
    data: items,
    pagination: { page, limit, total: count ?? 0 },
  };
}

/**
 * Creates a new training session for the authenticated user.
 *
 * Steps:
 *  1. Fetch the generation batch — returns 404 if missing or owned by another user.
 *  2. Validate batch status is "success" and contains a complete rounds mapping.
 *  3. Insert the new session row (DB trigger auto-abandons any in_progress sessions).
 *  4. Materialize round rows for the session from the generation batch payload.
 *  5. Compose and return SessionCreatedDTO.
 */
export async function createSession(
  command: CreateSessionCommand,
  userId: string,
  supabase: SupabaseClientType
): Promise<SessionCreatedDTO> {
  const { generation_batch_id, timer_seconds = 20 } = command;

  // Step 1: Fetch generation batch scoped to the current user (prevents IDOR)
  const { data: batch, error: batchError } = await supabase
    .from("generation_batches")
    .select("id, status, response_payload")
    .eq("id", generation_batch_id)
    .eq("user_id", userId)
    .single();

  if (batchError || !batch) {
    throw new BatchNotFoundError();
  }

  // Step 2: Validate batch status
  if (batch.status !== "success") {
    throw new BatchNotSuccessError();
  }

  const batchRounds = validateBatchRoundsPayload(batch.response_payload);

  // Step 3: Insert new session — DB trigger handles abandoning previous in_progress sessions
  const { data: session, error: insertError } = await supabase
    .from("sessions")
    .insert({
      user_id: userId,
      generation_batch_id,
      timer_seconds,
      status: "in_progress",
    })
    .select("id, status, generation_batch_id, timer_seconds, total_rounds, questions_per_round, started_at")
    .single();

  if (insertError || !session) {
    console.error("[sessions.service] Failed to insert session", { userId, generation_batch_id, insertError });
    throw new Error("Failed to create session.");
  }

  const roundRows = batchRounds.map((round) => ({
    session_id: session.id,
    position: round.position,
    status: "in_progress" as const,
  }));

  // Step 4: Materialize session rounds from the batch payload
  const { data: rounds, error: roundsError } = await supabase
    .from("rounds")
    .insert(roundRows)
    .select("id, position, status");

  if (roundsError || !rounds) {
    console.error("[sessions.service] Failed to materialize rounds", {
      userId,
      sessionId: session.id,
      generation_batch_id,
      roundsError,
    });

    const { error: rollbackError } = await supabase.from("sessions").delete().eq("id", session.id);
    if (rollbackError) {
      console.error("[sessions.service] Failed to roll back session after rounds insert error", {
        userId,
        sessionId: session.id,
        rollbackError,
      });
    }

    throw new Error("Failed to materialize session rounds.");
  }

  // Step 5: Compose response DTO
  const roundsSummary: RoundSummaryDTO[] = rounds
    .sort((left, right) => left.position - right.position)
    .map((r) => ({
      id: r.id,
      position: r.position,
      status: r.status,
    }));

  return {
    id: session.id,
    status: session.status,
    generation_batch_id: session.generation_batch_id,
    timer_seconds: session.timer_seconds,
    total_rounds: session.total_rounds,
    questions_per_round: session.questions_per_round,
    started_at: session.started_at,
    rounds: roundsSummary,
  };
}

// ---------------------------------------------------------------------------
// Get session by id
// ---------------------------------------------------------------------------

/**
 * Returns full details for a single session owned by the authenticated user.
 *
 * Uses a nested select to fetch rounds and their attempts in a single query.
 * RLS on the `sessions` table ensures that only sessions belonging to the
 * current user are returned — a missing row is treated as 404.
 *
 * @throws {NotFoundError} when the session does not exist or belongs to another user.
 */
export async function getSessionById(supabase: SupabaseClientType, sessionId: string): Promise<SessionDetailDTO> {
  const { data, error } = await supabase
    .from("sessions")
    .select(
      `id, status, timer_seconds, total_rounds, questions_per_round,
       generation_batch_id, started_at, completed_at, abandoned_at,
       rounds(id, position, status,
         attempts(verdict)
       )`
    )
    .eq("id", sessionId)
    .single();

  // PGRST116 = no rows returned; treat as not found regardless of the reason
  // (RLS silently filters out rows belonging to other users)
  if (error || !data) {
    throw new NotFoundError("Session not found.");
  }

  // Flatten attempts across all rounds to compute aggregate score summary
  interface RoundRow {
    id: string;
    position: number;
    status: string;
    attempts: { verdict: string | null }[];
  }
  const rounds = data.rounds as RoundRow[];

  const allAttempts = rounds.flatMap((r) => r.attempts);
  const total_questions = allAttempts.length;
  const knew_count = allAttempts.filter((a) => a.verdict === "knew").length;
  const did_not_know_count = allAttempts.filter((a) => a.verdict === "did_not_know").length;
  const scored = knew_count + did_not_know_count;

  const score_summary: ScoreSummaryDTO = {
    total_questions,
    knew_count,
    did_not_know_count,
    accuracy_percent: scored > 0 ? Math.round((knew_count / scored) * 1000) / 10 : 0,
  };

  const roundsSummary: RoundSummaryDTO[] = rounds
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ id: r.id, position: r.position, status: r.status as RoundSummaryDTO["status"] }));

  return {
    id: data.id,
    status: data.status,
    timer_seconds: data.timer_seconds,
    total_rounds: data.total_rounds,
    questions_per_round: data.questions_per_round,
    generation_batch_id: data.generation_batch_id,
    started_at: data.started_at,
    completed_at: data.completed_at,
    abandoned_at: data.abandoned_at,
    score_summary,
    rounds: roundsSummary,
  };
}

// ---------------------------------------------------------------------------
// Abandon session
// ---------------------------------------------------------------------------

/**
 * Transitions a session from `in_progress` to `abandoned`.
 *
 * Steps:
 *  1. SELECT the session filtered by id and user_id (IDOR-safe; RLS is a second layer).
 *  2. Verify the session status is `in_progress` — throw BadRequestError otherwise.
 *  3. UPDATE status to `abandoned` and set `abandoned_at = now()`.
 *  4. Delegate to `getSessionById` to return the full SessionDetailDTO.
 *
 * @throws {NotFoundError} when session does not exist or belongs to another user.
 * @throws {BadRequestError} when session status is not `in_progress`.
 */
export async function abandonSession(
  supabase: SupabaseClientType,
  sessionId: string,
  userId: string
): Promise<SessionDetailDTO> {
  // Step 1: Fetch session scoped to the current user
  const { data: session, error: selectError } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (selectError || !session) {
    throw new NotFoundError("Session not found.");
  }

  // Step 2: Validate state transition
  if (session.status !== "in_progress") {
    throw new BadRequestError("Only in_progress sessions can be abandoned.");
  }

  // Step 3: Update session status
  const { error: updateError } = await supabase
    .from("sessions")
    .update({ status: "abandoned", abandoned_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (updateError) {
    console.error("[sessions.service] Failed to abandon session", { sessionId, userId, updateError });
    throw updateError;
  }

  // Step 4: Return full detail DTO (RLS-scoped client reuses the user's session token)
  return getSessionById(supabase, sessionId);
}
