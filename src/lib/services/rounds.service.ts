import type { SupabaseClientType } from "@/db/supabase.client";
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from "@/lib/errors";
import type {
  CompleteRoundResponseDTO,
  CorrectAnswerDTO,
  RoundDTO,
  RoundQuestionDTO,
  RoundQuestionGroupDTO,
} from "@/types";
import { z } from "zod";

const SESSION_TOTAL_ROUNDS = 4;
const SESSION_QUESTIONS_PER_ROUND = 10;

const BatchRoundSchema = z.object({
  position: z.number().int().positive(),
  question_ids: z.array(z.string().uuid()),
});

const BatchResponsePayloadSchema = z.object({
  rounds: z.array(BatchRoundSchema).length(SESSION_TOTAL_ROUNDS),
});

interface SessionRoundRow {
  id: string;
  position: number;
  status: string;
  started_at: string;
}

interface SessionContext {
  id: string;
  timer_seconds: number;
  generation_batch_id: string | null;
  rounds: SessionRoundRow[];
}

interface QuestionRow {
  id: string;
  question_text: string;
  difficulty_score: number;
  correct_answer: unknown;
  question_categories: { categories: { name: string } | null }[];
}

const CompleteRoundTransitionResultSchema = z.object({
  session_id: z.string().uuid(),
  round_id: z.string().uuid(),
  round_position: z.number().int().positive(),
  round_status: z.string(),
  round_completed_at: z.string().datetime(),
  session_status: z.enum(["in_progress", "completed", "abandoned"]),
  session_completed_at: z.string().datetime().nullable(),
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

async function getSessionContext(
  supabase: SupabaseClientType,
  userId: string,
  sessionId: string
): Promise<SessionContext> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, timer_seconds, generation_batch_id, rounds(id, position, status, started_at)")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (error?.code === "PGRST116" || !data) {
    throw new NotFoundError("Session not found.");
  }

  if (error) {
    throw error;
  }

  return {
    id: data.id,
    timer_seconds: data.timer_seconds,
    generation_batch_id: data.generation_batch_id,
    rounds: ((data.rounds ?? []) as SessionRoundRow[]).sort((left, right) => left.position - right.position),
  };
}

async function getQuestionIdsForRound(
  supabase: SupabaseClientType,
  userId: string,
  generationBatchId: string | null,
  roundPosition: number
): Promise<string[]> {
  if (!generationBatchId) {
    throw new UnprocessableEntityError("Session is missing its generation batch mapping.");
  }

  const { data: batch, error } = await supabase
    .from("generation_batches")
    .select("response_payload")
    .eq("id", generationBatchId)
    .eq("user_id", userId)
    .single();

  if (error?.code === "PGRST116" || !batch) {
    throw new NotFoundError("Generation batch not found.");
  }

  if (error) {
    throw error;
  }

  const rounds = validateBatchRoundsPayload(batch.response_payload);
  const round = rounds.find((item) => item.position === roundPosition);

  if (!round) {
    throw new UnprocessableEntityError("Generation batch does not define the requested round.");
  }

  return round.question_ids;
}

async function getQuestionsForRound(
  supabase: SupabaseClientType,
  userId: string,
  questionIds: string[],
  revealAnswers: boolean
): Promise<RoundQuestionDTO[]> {
  const { data, error } = await supabase
    .from("questions")
    .select("id, question_text, difficulty_score, correct_answer, question_categories(categories(name))")
    .eq("user_id", userId)
    .in("id", questionIds);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as QuestionRow[];
  const questionsById = new Map(rows.map((row) => [row.id, row]));

  if (questionsById.size !== questionIds.length) {
    throw new UnprocessableEntityError("Round question mapping references missing questions.");
  }

  return questionIds.map((questionId, index) => {
    const question = questionsById.get(questionId);

    if (!question) {
      throw new UnprocessableEntityError("Round question mapping references missing questions.");
    }

    return {
      position: index + 1,
      question_id: question.id,
      question_text: question.question_text,
      difficulty_score: question.difficulty_score,
      categories: (question.question_categories ?? [])
        .map((entry) => entry.categories)
        .filter((category): category is { name: string } => category !== null),
      correct_answer: revealAnswers ? (question.correct_answer as CorrectAnswerDTO) : null,
    };
  });
}

export interface RoundContextById {
  sessionId: string;
  timerSeconds: number;
  generationBatchId: string | null;
  round: SessionRoundRow;
  sessionRounds: SessionRoundRow[];
  questionIds: string[];
}

export async function getRoundContextById(
  supabase: SupabaseClientType,
  userId: string,
  roundId: string
): Promise<RoundContextById> {
  const { data: roundRow, error: roundError } = await supabase
    .from("rounds")
    .select("id, position, status, started_at, session_id, sessions!inner(user_id, timer_seconds, generation_batch_id)")
    .eq("id", roundId)
    .eq("sessions.user_id", userId)
    .single();

  if (roundError?.code === "PGRST116" || !roundRow) {
    throw new NotFoundError("Round not found.");
  }

  if (roundError) {
    throw roundError;
  }

  const session = await getSessionContext(supabase, userId, roundRow.session_id);
  const round = session.rounds.find((item) => item.id === roundId);

  if (!round) {
    throw new NotFoundError("Round not found.");
  }

  const questionIds = await getQuestionIdsForRound(supabase, userId, session.generation_batch_id, round.position);

  return {
    sessionId: session.id,
    timerSeconds: session.timer_seconds,
    generationBatchId: session.generation_batch_id,
    round,
    sessionRounds: session.rounds,
    questionIds,
  };
}

export async function getRoundByPosition(
  supabase: SupabaseClientType,
  userId: string,
  sessionId: string,
  position: number
): Promise<RoundDTO> {
  const session = await getSessionContext(supabase, userId, sessionId);
  const round = session.rounds.find((item) => item.position === position);

  if (!round) {
    throw new NotFoundError("Round not found.");
  }

  if (position > 1) {
    const previousRound = session.rounds.find((item) => item.position === position - 1);

    if (!previousRound) {
      throw new UnprocessableEntityError("Session is missing a previous round.");
    }

    if (previousRound.status !== "completed") {
      throw new BadRequestError("You must complete the previous round before accessing this one.");
    }
  }

  const questionIds = await getQuestionIdsForRound(supabase, userId, session.generation_batch_id, position);
  const questions = await getQuestionsForRound(supabase, userId, questionIds, round.status === "completed");

  return {
    id: round.id,
    position: round.position,
    status: round.status,
    timer_seconds: session.timer_seconds,
    questions,
    started_at: round.started_at,
  };
}

function mapCompleteRoundRpcError(error: { message: string }): never {
  switch (error.message) {
    case "Session not found.":
    case "Round not found.":
      throw new NotFoundError(error.message);
    case "Round has already been completed.":
      throw new ConflictError(error.message);
    case "You must complete the previous round before completing this one.":
    case "Round cannot be completed until all attempts are recorded.":
    case "Session is missing a previous round.":
    case "Round can only be completed for an in-progress session.":
      throw new BadRequestError(error.message);
    default:
      throw error;
  }
}

interface CompleteRoundRpcResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

export async function completeRound(
  supabase: SupabaseClientType,
  userId: string,
  sessionId: string,
  roundId: string
): Promise<CompleteRoundResponseDTO> {
  const rpcClient = supabase as SupabaseClientType & {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<CompleteRoundRpcResponse>;
  };

  const { data, error } = await rpcClient.rpc("complete_round_session_transition", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_round_id: roundId,
  });

  if (error) {
    mapCompleteRoundRpcError(error);
  }

  const transition = CompleteRoundTransitionResultSchema.parse(data?.[0]);
  const completedRound = await getRoundByPosition(supabase, userId, transition.session_id, transition.round_position);

  return {
    ...completedRound,
    questions: completedRound.questions.map((question) => {
      if (!question.correct_answer) {
        throw new Error("Completed round response is missing a revealed correct answer.");
      }

      return {
        ...question,
        correct_answer: question.correct_answer,
      };
    }),
  };
}
