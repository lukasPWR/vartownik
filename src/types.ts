/**
 * Shared DTO and Command Model types for the VARtownik API.
 *
 * All types are derived from the database entity definitions in `src/db/database.types.ts`.
 * Use `Tables<"table_name">` as the canonical source of truth for field shapes;
 * DTOs are built with Pick / Omit / Partial to stay in sync.
 */

import type { Tables, Enums } from "@/db/database.types";

// ---------------------------------------------------------------------------
// Re-exported DB enum aliases — use these instead of raw string literals
// ---------------------------------------------------------------------------

export type QuestionStatus = Enums<"question_status_enum">;
export type GeneratedType = Enums<"generated_type_enum">;
export type SessionStatus = Enums<"session_status_enum">;
export type AttemptVerdict = Enums<"attempt_verdict_enum">;

// ---------------------------------------------------------------------------
// Shared / primitive DTOs
// ---------------------------------------------------------------------------

/** Standard pagination envelope returned by all list endpoints. */
export interface PaginationDTO {
  page: number;
  limit: number;
  total: number;
}

/** Correct-answer payload stored in `questions.correct_answer`. */
export interface CorrectAnswerDTO {
  primary: string;
  synonyms: string[];
}

// ---------------------------------------------------------------------------
// 1. Categories
// ---------------------------------------------------------------------------

/** Category item returned by GET /api/categories and related endpoints. */
export type CategoryDTO = Pick<Tables<"categories">, "id" | "name" | "slug" | "description" | "created_at">;

/** Slim category reference embedded in question responses. */
export type CategoryRefDTO = Pick<Tables<"categories">, "id" | "name">;

/** POST /api/categories request body. */
export interface CreateCategoryCommand {
  name: string;
  description?: string | null;
}

/** PATCH /api/categories/:id request body — all fields optional. */
export interface UpdateCategoryCommand {
  name?: string;
  description?: string | null;
}

/** GET /api/categories response envelope. */
export interface ListCategoriesResponseDTO {
  data: CategoryDTO[];
  pagination: PaginationDTO;
}

// ---------------------------------------------------------------------------
// 2. Tags
// ---------------------------------------------------------------------------

/** Tag item returned by GET /api/tags. */
export type TagDTO = Pick<Tables<"tags">, "id" | "name" | "created_at">;

/** POST /api/tags request body. */
export interface CreateTagCommand {
  name: string;
}

/** GET /api/tags response envelope (no pagination per API plan). */
export interface ListTagsResponseDTO {
  data: TagDTO[];
}

// ---------------------------------------------------------------------------
// 3. Questions
// ---------------------------------------------------------------------------

/** Edit history entry embedded in GET /api/questions/:id. */
export type QuestionEditHistoryDTO = Pick<Tables<"question_edits">, "id" | "change_reason" | "created_at">;

/** Question item returned in list responses (GET /api/questions). */
export interface QuestionDTO {
  id: string;
  generated_type: GeneratedType;
  status: QuestionStatus;
  question_text: string;
  /** Typed overlay on the raw Json column. */
  correct_answer: CorrectAnswerDTO;
  difficulty_score: number;
  image_path: string | null;
  source_model: string | null;
  categories: CategoryRefDTO[];
  tags: Pick<Tables<"tags">, "id" | "name">[];
  created_at: string;
}

/** Full question response for GET /api/questions/:id (includes edit history). */
export interface QuestionDetailDTO extends QuestionDTO {
  edit_history: QuestionEditHistoryDTO[];
  updated_at: string;
}

/** POST /api/questions request body — manual question creation. */
export interface CreateQuestionCommand {
  question_text: string;
  correct_answer: CorrectAnswerDTO;
  difficulty_score: number;
  category_ids: string[];
  tag_ids: string[];
  image_path?: string | null;
}

/**
 * PATCH /api/questions/:id request body.
 * `change_reason` is required by the audit trail even if other fields are unchanged.
 */
export interface UpdateQuestionCommand {
  question_text?: string;
  correct_answer?: Partial<CorrectAnswerDTO>;
  difficulty_score?: number;
  status?: QuestionStatus;
  category_ids?: string[];
  tag_ids?: string[];
  change_reason: string;
}

/** GET /api/questions response envelope. */
export interface ListQuestionsResponseDTO {
  data: QuestionDTO[];
  pagination: PaginationDTO;
}

// ---------------------------------------------------------------------------
// 4. Generation Batches
// ---------------------------------------------------------------------------

/**
 * Shared base for generation batch responses.
 * Picks the safe-to-expose subset of the `generation_batches` row.
 */
export type GenerationBatchDTO = Pick<
  Tables<"generation_batches">,
  | "id"
  | "status"
  | "model"
  | "provider"
  | "prompt_version"
  | "requested_questions_count"
  | "returned_questions_count"
  | "retry_count"
  | "estimated_cost_usd"
  | "error_message"
  | "finished_at"
  | "created_at"
>;

/**
 * Response 201 — batch accepted and queued (status = "pending").
 * Identical shape to GenerationBatchDTO; alias for semantic clarity.
 */
export type GenerationBatchCreatedDTO = GenerationBatchDTO;

/**
 * Grouping of question IDs per round — part of the 202 success response.
 * Derived from the rounds table's `position` field.
 */
export interface RoundQuestionGroupDTO {
  /** 1-based round position (1–4). */
  position: number;
  question_ids: string[];
}

/**
 * Response 202 — batch completed inline (status = "success").
 * Extends the base batch fields with the distributed round data.
 */
export interface GenerationBatchSuccessDTO
  extends Pick<
    Tables<"generation_batches">,
    "id" | "status" | "returned_questions_count" | "retry_count" | "estimated_cost_usd" | "finished_at"
  > {
  rounds: RoundQuestionGroupDTO[];
}

/** POST /api/generation-batches request body. */
export interface CreateGenerationBatchCommand {
  model: string;
  provider: string;
  prompt_version: string;
  requested_questions_count: number;
}

/** GET /api/generation-batches response envelope. */
export interface ListGenerationBatchesResponseDTO {
  data: GenerationBatchDTO[];
  pagination: PaginationDTO;
}

// ---------------------------------------------------------------------------
// 5. Sessions
// ---------------------------------------------------------------------------

/** Score breakdown embedded in list and detail session responses. */
export interface ScoreSummaryDTO {
  total_questions: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number;
}

/** Slim round reference embedded in the POST /api/sessions 201 response. */
export type RoundSummaryDTO = Pick<Tables<"rounds">, "id" | "position" | "status">;

/** Session item returned by GET /api/sessions. */
export interface SessionDTO {
  id: string;
  status: SessionStatus;
  timer_seconds: number;
  total_rounds: number;
  questions_per_round: number;
  started_at: string;
  completed_at: string | null;
  score_summary: ScoreSummaryDTO;
}

/** Full session detail returned by GET /api/sessions/:id. */
export interface SessionDetailDTO extends Omit<SessionDTO, "score_summary"> {
  generation_batch_id: string | null;
  abandoned_at: string | null;
  score_summary: ScoreSummaryDTO;
  rounds: RoundSummaryDTO[];
}

/** Response body for POST /api/sessions (201 Created). */
export interface SessionCreatedDTO {
  id: string;
  status: SessionStatus;
  generation_batch_id: string | null;
  timer_seconds: number;
  total_rounds: number;
  questions_per_round: number;
  started_at: string;
  rounds: RoundSummaryDTO[];
}

/** POST /api/sessions request body. */
export interface CreateSessionCommand {
  generation_batch_id: string;
  timer_seconds?: number;
}

/**
 * PATCH /api/sessions/:id request body.
 * Only "abandoned" is a valid transition from "in_progress".
 */
export interface UpdateSessionCommand {
  status: "abandoned";
}

/** GET /api/sessions response envelope. */
export interface ListSessionsResponseDTO {
  data: SessionDTO[];
  pagination: PaginationDTO;
}

// ---------------------------------------------------------------------------
// 6. Rounds
// ---------------------------------------------------------------------------

/** Per-question entry within a round response. */
export interface RoundQuestionDTO {
  /** 1-based position of the question within the round. */
  position: number;
  question_id: string;
  question_text: string;
  difficulty_score: number;
  categories: Pick<Tables<"categories">, "name">[];
  /**
   * Null while round.status = "in_progress" (answer masked server-side).
   * Populated after the round is completed.
   */
  correct_answer: CorrectAnswerDTO | null;
}

/** Full round response for GET /api/sessions/:sessionId/rounds/:position. */
export interface RoundDTO {
  id: string;
  position: number;
  status: string;
  /**
   * Timer inherited from the parent session; duplicated here for convenience
   * so the client does not need to fetch the session separately.
   */
  timer_seconds: number;
  questions: RoundQuestionDTO[];
  started_at: string;
}

/**
 * Response for POST /api/sessions/:sessionId/rounds/:roundId/complete.
 * Same shape as RoundDTO but `correct_answer` is guaranteed non-null.
 */
export interface CompleteRoundResponseDTO extends Omit<RoundDTO, "questions"> {
  questions: (Omit<RoundQuestionDTO, "correct_answer"> & {
    correct_answer: CorrectAnswerDTO;
  })[];
}

// ---------------------------------------------------------------------------
// 7. Attempts
// ---------------------------------------------------------------------------

/** Attempt item returned by POST /api/rounds/:roundId/attempts (201). */
export interface AttemptDTO {
  id: number;
  question_id: string;
  position: number;
  scratchpad: string | null;
  time_taken_ms: number;
  timer_expired: boolean;
  verdict: AttemptVerdict | null;
  is_flagged_by_user: boolean;
  created_at: string;
}

/** POST /api/rounds/:roundId/attempts request body. */
export interface CreateAttemptCommand {
  question_id: string;
  position: number;
  scratchpad?: string | null;
  time_taken_ms: number;
  timer_expired: boolean;
}

/**
 * PATCH /api/attempts/:id request body.
 * Used for self-assessment verdict and/or flagging after round completion.
 */
export interface UpdateAttemptCommand {
  verdict?: AttemptVerdict | null;
  is_flagged_by_user?: boolean;
  flag_reason?: string | null;
}

// ---------------------------------------------------------------------------
// 8. User Preferences
// ---------------------------------------------------------------------------

/**
 * Category weights map: slug → weight (0.0–1.0).
 * Values should sum to ≤ 1.0.
 */
export type CategoryWeightsMap = Record<string, number>;

/** GET /api/user/preferences response. */
export interface UserPreferencesDTO {
  user_id: string;
  default_timer_seconds: number;
  /** Typed overlay on the raw Json column. */
  category_weights: CategoryWeightsMap;
  storage_limit_questions: number;
  storage_limit_images_bytes: number;
  updated_at: string;
}

/**
 * PUT /api/user/preferences request body (upsert).
 * Both fields are optional — only supplied keys are updated.
 */
export interface UpdateUserPreferencesCommand {
  default_timer_seconds?: number;
  category_weights?: CategoryWeightsMap;
}

// ---------------------------------------------------------------------------
// 9. Stats
// ---------------------------------------------------------------------------

/** GET /api/stats/overview response. */
export interface StatsOverviewDTO {
  total_attempts: number;
  knew_count: number;
  did_not_know_count: number;
  overall_accuracy_percent: number;
  total_sessions_completed: number;
  flagged_questions_pending: number;
}

/** Single-category row in GET /api/stats/categories. */
export interface CategoryStatsDTO {
  category_id: string;
  category_name: string;
  attempts_count: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number;
}

/** GET /api/stats/categories response envelope. */
export interface CategoryStatsResponseDTO {
  data: CategoryStatsDTO[];
}
