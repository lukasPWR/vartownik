import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import type { Json, Tables, TablesInsert, TablesUpdate } from "@/db/database.types";
import type { SupabaseClientType } from "@/db/supabase.client";
import {
  AiParseError,
  AiProviderError,
  ConflictError,
  GenerationPersistenceError,
  NotFoundError,
  RateLimitError,
} from "@/lib/errors";
import {
  type GeneratedQuestion,
  type GenerationExecutionAggregate,
  type GenerationExecutionError,
  type GenerationProvider,
  orchestrateGeneration,
} from "@/lib/services/generation-orchestrator";
import { GENERATION_POLICY, admitGenerationRequest } from "@/lib/services/generation-policy";
import type {
  GenerationBatchCreatedDTO,
  GenerationBatchDTO,
  GenerationBatchStatusDTO,
  GenerationBatchSuccessDTO,
  ListGenerationBatchesResponseDTO,
  RoundQuestionGroupDTO,
} from "@/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const QUESTIONS_PER_ROUND = 10;
const STALE_PENDING_AFTER_MS = 60_000;
const INPUT_TOKEN_BUDGET_PER_ATTEMPT = 1_000;

// ---------------------------------------------------------------------------
// Lifecycle contracts
// ---------------------------------------------------------------------------

type GenerationBatchRow = Tables<"generation_batches">;
type GenerationBatchInsert = TablesInsert<"generation_batches">;
type GenerationBatchUpdate = TablesUpdate<"generation_batches">;

interface GenerationBatchCommandInput {
  model: string;
  provider: string;
  prompt_version: string;
  requested_questions_count: number;
}

interface CanonicalRequestPayload {
  provider: string;
  model: string;
  prompt_version: string;
  requested_questions_count: number;
  execution_policy: {
    max_attempts: number;
    max_retries: number;
    max_output_tokens_per_attempt: number;
    deadline_ms: number;
    preflight_cost_ceiling_usd: number;
  };
}

export interface GenerationBatchLifecycleRepository {
  countRecent(userId: string, createdAtOrAfter: string): Promise<number | null>;
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<GenerationBatchRow | null>;
  findPending(userId: string): Promise<GenerationBatchRow | null>;
  recoverStalePending(batchId: string, createdBefore: string, finishedAt: string): Promise<boolean>;
  insertPending(input: GenerationBatchInsert): Promise<GenerationBatchRow>;
  finalizePending(batchId: string, update: GenerationBatchUpdate): Promise<GenerationBatchRow | null>;
}

export interface GenerationBatchServiceOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  provider?: GenerationProvider;
  repository?: GenerationBatchLifecycleRepository;
  now?: () => number;
  persistQuestions?: (
    questions: GeneratedQuestion[],
    batchId: string,
    model: string,
    userId: string
  ) => Promise<string[]>;
}

const GenerationResponsePayloadSchema = z.object({
  rounds: z.array(
    z.object({
      position: z.number().int().positive(),
      question_ids: z.array(z.string()),
    })
  ),
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Throws `RateLimitError` if the user has exceeded RATE_LIMIT_MAX
 * generation batches within the last RATE_LIMIT_WINDOW_MINUTES minutes.
 */
async function checkRateLimit(userId: string, repository: GenerationBatchLifecycleRepository): Promise<void> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const count = await repository.countRecent(userId, windowStart);

  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    throw new RateLimitError(
      `You can generate at most ${RATE_LIMIT_MAX} batches per ${RATE_LIMIT_WINDOW_MINUTES} minutes.`
    );
  }
}

// ---------------------------------------------------------------------------
// Supabase lifecycle repository
// ---------------------------------------------------------------------------

function createSupabaseLifecycleRepository(supabase: SupabaseClientType): GenerationBatchLifecycleRepository {
  return {
    async countRecent(userId, createdAtOrAfter) {
      const { count, error } = await supabase
        .from("generation_batches")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", createdAtOrAfter);

      if (error) {
        console.error("[generation-batch] Rate limit check failed", { userId, error });
        return null;
      }

      return count ?? 0;
    },

    async findByIdempotencyKey(userId, idempotencyKey) {
      const { data, error } = await supabase
        .from("generation_batches")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (error) throw error;
      return data;
    },

    async findPending(userId) {
      const { data, error } = await supabase
        .from("generation_batches")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending")
        .maybeSingle();

      if (error) throw error;
      return data;
    },

    async recoverStalePending(batchId, createdBefore, finishedAt) {
      const { data, error } = await supabase
        .from("generation_batches")
        .update({
          status: "failed",
          failure_code: "stale_pending",
          error_message: "Generation batch exceeded the stale pending threshold.",
          finished_at: finishedAt,
        })
        .eq("id", batchId)
        .eq("status", "pending")
        .lt("created_at", createdBefore)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      return data !== null;
    },

    async insertPending(input) {
      const { data, error } = await supabase.from("generation_batches").insert(input).select("*").single();
      if (error || !data) throw error ?? new Error("Pending batch insert returned no row.");
      return data;
    },

    async finalizePending(batchId, update) {
      const { data, error } = await supabase
        .from("generation_batches")
        .update(update)
        .eq("id", batchId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  };
}

function persistenceError(message: string, cause: unknown): GenerationPersistenceError {
  const error = new GenerationPersistenceError(message);
  Object.defineProperty(error, "cause", { configurable: true, value: cause });
  return error;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function canonicalPayload(command: GenerationBatchCommandInput): CanonicalRequestPayload {
  return {
    provider: command.provider,
    model: command.model,
    prompt_version: command.prompt_version,
    requested_questions_count: command.requested_questions_count,
    execution_policy: {
      max_attempts: GENERATION_POLICY.maxAttempts,
      max_retries: GENERATION_POLICY.maxRetries,
      max_output_tokens_per_attempt: GENERATION_POLICY.maxOutputTokensPerAttempt,
      deadline_ms: GENERATION_POLICY.deadlineMs,
      preflight_cost_ceiling_usd: GENERATION_POLICY.preflightCostCeilingUsd,
    },
  };
}

function hasEquivalentPayload(row: GenerationBatchRow, payload: CanonicalRequestPayload): boolean {
  const stored = row.request_payload;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return false;
  const execution = stored.execution_policy;
  if (typeof execution !== "object" || execution === null || Array.isArray(execution)) return false;

  return (
    stored.provider === payload.provider &&
    stored.model === payload.model &&
    stored.prompt_version === payload.prompt_version &&
    stored.requested_questions_count === payload.requested_questions_count &&
    execution.max_attempts === payload.execution_policy.max_attempts &&
    execution.max_retries === payload.execution_policy.max_retries &&
    execution.max_output_tokens_per_attempt === payload.execution_policy.max_output_tokens_per_attempt &&
    execution.deadline_ms === payload.execution_policy.deadline_ms &&
    execution.preflight_cost_ceiling_usd === payload.execution_policy.preflight_cost_ceiling_usd
  );
}

function toBatchDTO(row: GenerationBatchRow): GenerationBatchDTO {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    provider: row.provider,
    prompt_version: row.prompt_version,
    requested_questions_count: row.requested_questions_count,
    returned_questions_count: row.returned_questions_count,
    provider_attempt_count: row.provider_attempt_count,
    retry_count: row.retry_count,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    estimated_cost_usd: row.estimated_cost_usd,
    failure_code: row.failure_code,
    error_message: row.error_message,
    finished_at: row.finished_at,
    created_at: row.created_at,
  };
}

function toSuccessDTO(row: GenerationBatchRow): GenerationBatchSuccessDTO {
  const responsePayload = GenerationResponsePayloadSchema.safeParse(row.response_payload);
  if (!responsePayload.success) {
    throw persistenceError("Successful generation batch has an invalid response payload.", responsePayload.error);
  }

  return {
    id: row.id,
    status: row.status,
    returned_questions_count: row.returned_questions_count,
    provider_attempt_count: row.provider_attempt_count,
    retry_count: row.retry_count,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    estimated_cost_usd: row.estimated_cost_usd,
    failure_code: row.failure_code,
    finished_at: row.finished_at,
    rounds: responsePayload.data.rounds,
  };
}

// ---------------------------------------------------------------------------
// Question deduplication & insertion
// ---------------------------------------------------------------------------

function computeContentHash(questionText: string): string {
  return createHash("sha256").update(questionText.trim().toLowerCase()).digest("hex");
}

/**
 * Resolves category slugs to category IDs for the given user.
 * Returns a map of slug → id; missing slugs are omitted silently.
 */
async function resolveCategoryIds(
  slugs: string[],
  userId: string,
  supabase: SupabaseClientType
): Promise<Map<string, string>> {
  const uniqueSlugs = [...new Set(slugs)];

  const { data, error } = await supabase
    .from("categories")
    .select("id, slug")
    .eq("user_id", userId)
    .in("slug", uniqueSlugs);

  if (error) {
    console.error("[generation-batch] Failed to resolve category IDs", { error });
    return new Map();
  }

  return new Map((data ?? []).map((c) => [c.slug, c.id]));
}

/**
 * Inserts new questions (skipping duplicates via content_hash), then inserts
 * question_categories rows. Returns the UUIDs of all inserted questions.
 */
async function insertQuestionsAndCategories(
  questions: GeneratedQuestion[],
  batchId: string,
  model: string,
  userId: string,
  supabase: SupabaseClientType
): Promise<string[]> {
  // 1. Compute content hashes for deduplication
  const withHashes = questions.map((q) => ({
    ...q,
    content_hash: computeContentHash(q.question_text),
  }));

  // 2. Find existing hashes to skip
  const hashes = withHashes.map((q) => q.content_hash);
  const { data: existingRows } = await supabase
    .from("questions")
    .select("content_hash")
    .eq("user_id", userId)
    .in("content_hash", hashes);

  const existingHashes = new Set((existingRows ?? []).map((r) => r.content_hash));
  const newQuestions = withHashes.filter((q) => !existingHashes.has(q.content_hash));

  if (newQuestions.length === 0) {
    return [];
  }

  // 3. Resolve category slugs → IDs
  const slugs = newQuestions.map((q) => q.category_slug);
  const slugToId = await resolveCategoryIds(slugs, userId, supabase);

  // 4. Batch insert questions
  const questionRows = newQuestions.map((q) => ({
    user_id: userId,
    question_text: q.question_text,
    correct_answer: q.correct_answer,
    // AI returns 0–1 float; DB expects smallint 1–5
    difficulty_score: Math.max(1, Math.min(5, Math.round(q.difficulty_score * 4) + 1)),
    content_hash: q.content_hash,
    generated_type: "ai" as const,
    source_model: model,
    generation_metadata: { batch_id: batchId },
    status: "active" as const,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("questions")
    .insert(questionRows)
    .select("id, content_hash");

  if (insertError || !inserted) {
    throw new Error(`Failed to insert questions: ${insertError?.message}`);
  }

  // 5. Build question_categories rows
  const hashToId = new Map(inserted.map((r) => [r.content_hash, r.id]));
  const categoryRows: { question_id: string; category_id: string }[] = [];

  for (const q of newQuestions) {
    const questionId = hashToId.get(q.content_hash);
    const categoryId = slugToId.get(q.category_slug);

    if (questionId && categoryId) {
      categoryRows.push({ question_id: questionId, category_id: categoryId });
    }
  }

  if (categoryRows.length > 0) {
    const { error: catError } = await supabase.from("question_categories").insert(categoryRows);

    if (catError) {
      console.error("[generation-batch] Failed to insert question_categories", { catError });
    }
  }

  return inserted.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Round distribution
// ---------------------------------------------------------------------------

function distributeToRounds(questionIds: string[], questionsPerRound: number): RoundQuestionGroupDTO[] {
  const rounds: RoundQuestionGroupDTO[] = [];
  let position = 1;

  for (let i = 0; i < questionIds.length; i += questionsPerRound) {
    rounds.push({
      position,
      question_ids: questionIds.slice(i, i + questionsPerRound),
    });
    position++;
  }

  return rounds;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GenerationBatchCreateResult = GenerationBatchCreatedDTO | GenerationBatchSuccessDTO;

function isStalePending(row: GenerationBatchRow, now: number): boolean {
  const createdAt = Date.parse(row.created_at);
  return Number.isFinite(createdAt) && createdAt < now - STALE_PENDING_AFTER_MS;
}

async function recoverStalePending(
  row: GenerationBatchRow,
  repository: GenerationBatchLifecycleRepository,
  now: number
): Promise<boolean> {
  try {
    return await repository.recoverStalePending(
      row.id,
      new Date(now - STALE_PENDING_AFTER_MS).toISOString(),
      new Date(now).toISOString()
    );
  } catch (error) {
    throw persistenceError("Failed to recover a stale generation batch.", error);
  }
}

function replayBatch(row: GenerationBatchRow): GenerationBatchCreateResult {
  if (row.status === "pending") return toBatchDTO(row);
  if (row.status === "success") return toSuccessDTO(row);

  throw new ConflictError("The idempotency key belongs to a failed generation batch; use a new key.");
}

async function resolveExistingAdmission(
  repository: GenerationBatchLifecycleRepository,
  userId: string,
  idempotencyKey: string,
  payload: CanonicalRequestPayload,
  now: number
): Promise<GenerationBatchCreateResult | null> {
  let sameKey: GenerationBatchRow | null;
  let active: GenerationBatchRow | null;

  try {
    sameKey = await repository.findByIdempotencyKey(userId, idempotencyKey);
  } catch (error) {
    throw persistenceError("Failed to resolve generation idempotency.", error);
  }

  if (sameKey) {
    if (!hasEquivalentPayload(sameKey, payload)) {
      throw new ConflictError("The idempotency key was already used with a different generation payload.");
    }

    if (sameKey.status === "pending" && isStalePending(sameKey, now)) {
      const recovered = await recoverStalePending(sameKey, repository, now);
      if (recovered) {
        throw new ConflictError("The stale generation batch was closed; retry with a new idempotency key.");
      }

      try {
        sameKey = await repository.findByIdempotencyKey(userId, idempotencyKey);
      } catch (error) {
        throw persistenceError("Failed to resolve idempotency after stale recovery.", error);
      }

      if (!sameKey || !hasEquivalentPayload(sameKey, payload)) {
        throw persistenceError(
          "Generation idempotency changed while recovering a stale batch.",
          new Error("Idempotency race could not be resolved.")
        );
      }
    }

    return replayBatch(sameKey);
  }

  try {
    active = await repository.findPending(userId);
  } catch (error) {
    throw persistenceError("Failed to resolve the active generation batch.", error);
  }

  if (!active) return null;

  if (isStalePending(active, now)) {
    const recovered = await recoverStalePending(active, repository, now);
    if (recovered) return null;

    try {
      active = await repository.findPending(userId);
    } catch (error) {
      throw persistenceError("Failed to resolve the active generation batch after stale recovery.", error);
    }

    if (!active) return null;
  }

  if (hasEquivalentPayload(active, payload)) return toBatchDTO(active);

  throw new ConflictError("Another generation batch with a different payload is already pending.");
}

function aggregateFromError(error: unknown): GenerationExecutionAggregate {
  if (error instanceof Error && "aggregate" in error) {
    return (error as GenerationExecutionError).aggregate;
  }

  return { attemptCount: 0, retryCount: 0, inputTokens: 0, outputTokens: 0, observedCostUsd: 0 };
}

function failureCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof AiProviderError) return "provider_failed";
  if (error instanceof AiParseError) return "parse_failed";
  return "generation_failed";
}

function telemetryUpdate(
  aggregate: GenerationExecutionAggregate
): Pick<
  GenerationBatchUpdate,
  "provider_attempt_count" | "retry_count" | "input_tokens" | "output_tokens" | "estimated_cost_usd"
> {
  return {
    provider_attempt_count: aggregate.attemptCount,
    retry_count: aggregate.retryCount,
    input_tokens: aggregate.inputTokens,
    output_tokens: aggregate.outputTokens,
    estimated_cost_usd: Number(aggregate.observedCostUsd.toFixed(6)),
  };
}

async function finalizePendingOrThrow(
  repository: GenerationBatchLifecycleRepository,
  batchId: string,
  update: GenerationBatchUpdate
): Promise<GenerationBatchRow> {
  try {
    const row = await repository.finalizePending(batchId, update);
    if (!row) {
      throw new Error("The batch was no longer pending when finalization was attempted.");
    }
    return row;
  } catch (error) {
    if (error instanceof GenerationPersistenceError) throw error;
    throw persistenceError("Generation batch finalization was not confirmed.", error);
  }
}

/**
 * Orchestrates the full generation batch lifecycle:
 * idempotency → policy/rate limit → pending → generation → persistence → terminal state.
 *
 * Phase 4 will always supply an idempotency key and request signal from HTTP.
 * Until then a fresh key keeps the existing route source-compatible.
 */
export async function createGenerationBatch(
  command: GenerationBatchCommandInput,
  userId: string,
  supabase: SupabaseClientType | null,
  options: GenerationBatchServiceOptions = {}
): Promise<GenerationBatchCreateResult> {
  const now = options.now ?? Date.now;
  const repository = options.repository ?? (supabase ? createSupabaseLifecycleRepository(supabase) : null);

  if (!repository) {
    throw persistenceError("Generation lifecycle repository is unavailable.", new Error("Missing Supabase client."));
  }

  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  const payload = canonicalPayload(command);
  const replay = await resolveExistingAdmission(repository, userId, idempotencyKey, payload, now());
  if (replay) return replay;

  const admission = admitGenerationRequest(
    {
      provider: command.provider,
      model: command.model,
      promptVersion: command.prompt_version,
      requestedQuestionsCount: command.requested_questions_count,
    },
    {
      budget: {
        attemptCount: GENERATION_POLICY.maxAttempts,
        retryCount: GENERATION_POLICY.maxRetries,
        inputTokensPerAttempt: INPUT_TOKEN_BUDGET_PER_ATTEMPT,
        outputTokensPerAttempt: GENERATION_POLICY.maxOutputTokensPerAttempt,
        deadlineMs: GENERATION_POLICY.deadlineMs,
      },
    }
  );

  await checkRateLimit(userId, repository);

  let batch: GenerationBatchRow;
  try {
    batch = await repository.insertPending({
      user_id: userId,
      model: command.model,
      provider: command.provider,
      prompt_version: command.prompt_version,
      requested_questions_count: command.requested_questions_count,
      status: "pending",
      idempotency_key: idempotencyKey,
      request_payload: {
        ...payload,
        execution_policy: {
          ...payload.execution_policy,
          projected_input_tokens_per_attempt: INPUT_TOKEN_BUDGET_PER_ATTEMPT,
          projected_worst_case_cost_usd: admission.worstCaseCostUsd,
        },
      } as Json,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raceWinner = await resolveExistingAdmission(repository, userId, idempotencyKey, payload, now());
      if (raceWinner) return raceWinner;
    }
    throw persistenceError("Failed to create a pending generation batch.", error);
  }

  let aggregate: GenerationExecutionAggregate = aggregateFromError(null);
  let questions: GeneratedQuestion[];

  try {
    const provider = options.provider ?? (await import("@/lib/openai.client")).openAIProvider;
    const execution = await orchestrateGeneration({
      provider,
      deadlineAt: now() + GENERATION_POLICY.deadlineMs,
      signal: options.signal,
    });
    questions = execution.questions;
    aggregate = execution.aggregate;
  } catch (error) {
    aggregate = aggregateFromError(error);
    await finalizePendingOrThrow(repository, batch.id, {
      status: "failed",
      ...telemetryUpdate(aggregate),
      failure_code: failureCode(error),
      error_message: error instanceof Error ? error.message : String(error),
      finished_at: new Date(now()).toISOString(),
    });
    throw error;
  }

  let questionIds: string[];
  try {
    const persistQuestions =
      options.persistQuestions ??
      (supabase
        ? (generated: GeneratedQuestion[], batchId: string, model: string, ownerId: string) =>
            insertQuestionsAndCategories(generated, batchId, model, ownerId, supabase)
        : null);

    if (!persistQuestions) throw new Error("Question persistence is unavailable.");
    questionIds = await persistQuestions(questions, batch.id, command.model, userId);
  } catch (error) {
    await finalizePendingOrThrow(repository, batch.id, {
      status: "failed",
      ...telemetryUpdate(aggregate),
      failure_code: "persistence_failed",
      error_message: error instanceof Error ? error.message : String(error),
      finished_at: new Date(now()).toISOString(),
    });
    throw persistenceError("Failed to persist generated questions.", error);
  }

  const rounds = distributeToRounds(questionIds, QUESTIONS_PER_ROUND);
  const finalized = await finalizePendingOrThrow(repository, batch.id, {
    status: "success",
    returned_questions_count: questionIds.length,
    ...telemetryUpdate(aggregate),
    failure_code: null,
    error_message: null,
    response_payload: { rounds } as unknown as Json,
    finished_at: new Date(now()).toISOString(),
  });

  return toSuccessDTO(finalized);
}

// ---------------------------------------------------------------------------
// Get batch by ID (status poll)
// ---------------------------------------------------------------------------

/**
 * Retrieves the status fields of a single generation batch owned by `userId`.
 * Throws `NotFoundError` when the batch does not exist or belongs to another user.
 */
export async function getGenerationBatchById(
  supabase: SupabaseClientType,
  id: string,
  userId: string
): Promise<GenerationBatchStatusDTO> {
  const { data, error } = await supabase
    .from("generation_batches")
    .select(
      "id, status, returned_questions_count, provider_attempt_count, retry_count, input_tokens, output_tokens, estimated_cost_usd, failure_code, error_message, finished_at"
    )
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) {
    // PGRST116 = no rows returned by .single()
    if (error.code === "PGRST116") {
      throw new NotFoundError("Generation batch not found");
    }
    console.error("[generation-batch] getGenerationBatchById failed", { id, userId, error });
    throw error;
  }

  if (!data) {
    throw new NotFoundError("Generation batch not found");
  }

  return data;
}

// ---------------------------------------------------------------------------
// List generation batches (paginated)
// ---------------------------------------------------------------------------

/** Zod schema for query params of GET /api/generation-batches. */
export const ListGenerationBatchesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "success", "failed"]).optional(),
});

export type ListGenerationBatchesQuery = z.infer<typeof ListGenerationBatchesQuerySchema>;

/**
 * Returns a paginated list of generation batches owned by `userId`.
 * Applies optional `status` filter and orders by `created_at DESC`.
 */
export async function listGenerationBatches(
  supabase: SupabaseClientType,
  query: ListGenerationBatchesQuery,
  userId: string
): Promise<ListGenerationBatchesResponseDTO> {
  const offset = (query.page - 1) * query.limit;

  let dbQuery = supabase
    .from("generation_batches")
    .select(
      "id, status, model, provider, prompt_version, requested_questions_count, returned_questions_count, provider_attempt_count, retry_count, input_tokens, output_tokens, estimated_cost_usd, failure_code, error_message, finished_at, created_at",
      { count: "exact" }
    )
    .eq("user_id", userId);

  if (query.status !== undefined) {
    dbQuery = dbQuery.eq("status", query.status);
  }

  const { data, error, count } = await dbQuery
    .order("created_at", { ascending: false })
    .range(offset, offset + query.limit - 1);

  if (error) {
    console.error("[generation-batch] listGenerationBatches failed", { userId, query, error });
    throw new Error("Failed to list generation batches");
  }

  return {
    data: (data ?? []) as GenerationBatchDTO[],
    pagination: {
      page: query.page,
      limit: query.limit,
      total: count ?? 0,
    },
  };
}
