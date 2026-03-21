import { createHash } from "crypto";
import { z } from "zod";

import type { SupabaseClientType } from "@/db/supabase.client";
import { callOpenRouter } from "@/lib/openrouter.client";
import { callGoogle } from "@/lib/google.client";
import { buildPrompt } from "@/lib/prompts/quiz-generation.v1";
import { AiParseError, OpenRouterError, RateLimitError } from "@/lib/errors";
import type { CreateGenerationBatchCommand, GenerationBatchSuccessDTO, RoundQuestionGroupDTO } from "@/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_RETRIES = 2;
const QUESTIONS_PER_ROUND = 10;

// ---------------------------------------------------------------------------
// Zod schemas for AI response validation
// ---------------------------------------------------------------------------

const AiQuestionSchema = z.object({
  question_text: z.string().min(5).max(1000),
  correct_answer: z.object({
    primary: z.string().min(1).max(1000),
    synonyms: z.array(z.string()).default([]),
  }),
  difficulty_score: z.number().min(0).max(1),
  category_slug: z.string().min(1).max(100),
});

const AiResponseSchema = z.array(AiQuestionSchema);

type AiQuestion = z.infer<typeof AiQuestionSchema>;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Throws `RateLimitError` if the user has exceeded RATE_LIMIT_MAX
 * generation batches within the last RATE_LIMIT_WINDOW_MINUTES minutes.
 */
async function checkRateLimit(userId: string, supabase: SupabaseClientType): Promise<void> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("generation_batches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[generation-batch] Rate limit check failed", { userId, error });
    // Fail open — let the request through if the check itself errors
    return;
  }

  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    throw new RateLimitError(
      `You can generate at most ${RATE_LIMIT_MAX} batches per ${RATE_LIMIT_WINDOW_MINUTES} minutes.`
    );
  }
}

// ---------------------------------------------------------------------------
// Batch DB operations
// ---------------------------------------------------------------------------

async function insertPendingBatch(
  command: CreateGenerationBatchCommand,
  userId: string,
  supabase: SupabaseClientType
): Promise<string> {
  const requestPayload = {
    model: command.model,
    prompt_version: command.prompt_version,
    requested_questions_count: command.requested_questions_count,
  };

  const { data, error } = await supabase
    .from("generation_batches")
    .insert({
      user_id: userId,
      model: command.model,
      provider: command.provider,
      prompt_version: command.prompt_version,
      requested_questions_count: command.requested_questions_count,
      status: "pending",
      request_payload: requestPayload,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create generation batch: ${error?.message}`);
  }

  return data.id;
}

async function finalizeBatch(
  batchId: string,
  result:
    | { success: true; returnedCount: number; estimatedCostUsd: number | null; responsePayload: unknown }
    | { success: false; errorMessage: string; retryCount: number },
  supabase: SupabaseClientType
): Promise<void> {
  if (result.success) {
    const { error } = await supabase
      .from("generation_batches")
      .update({
        status: "success",
        returned_questions_count: result.returnedCount,
        estimated_cost_usd: result.estimatedCostUsd,
        response_payload: result.responsePayload as never,
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    if (error) {
      console.error("[generation-batch] Failed to finalize batch as success", { batchId, error });
    }
  } else {
    const { error } = await supabase
      .from("generation_batches")
      .update({
        status: "failed",
        error_message: result.errorMessage,
        retry_count: result.retryCount,
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    if (error) {
      console.error("[generation-batch] Failed to finalize batch as failed", { batchId, error });
    }
  }
}

// ---------------------------------------------------------------------------
// OpenRouter call with retry
// ---------------------------------------------------------------------------

/**
 * Calls the appropriate AI provider and parses the response as an array of questions.
 * Retries up to MAX_RETRIES times on JSON / schema parse failures.
 * Throws `AiParseError` after exhausting all attempts.
 */
async function callAiWithRetry(
  provider: string,
  model: string,
  promptVersion: string,
  count: number
): Promise<{ questions: AiQuestion[]; estimatedCostUsd: number | null; retryCount: number }> {
  if (promptVersion !== "v1") {
    throw new Error(`Unsupported prompt version: ${promptVersion}`);
  }

  const messages = buildPrompt(count);
  let lastError: Error = new Error("Unknown error");
  let retryCount = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      retryCount = attempt;
    }

    try {
      const { content, estimatedCostUsd } =
        provider === "google" ? await callGoogle(model, messages) : await callOpenRouter(model, messages);

      // Strip optional markdown code fences the model may add despite instructions
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

      const parsed: unknown = JSON.parse(cleaned);
      const validated = AiResponseSchema.parse(parsed);

      console.log(`[generation-batch] Generated ${validated.length} question(s):`);
      validated.forEach((q, i) => {
        console.log(`  [${i + 1}] Q: ${q.question_text}`);
        console.log(`       A: ${q.correct_answer.primary}`);
      });

      return { questions: validated, estimatedCostUsd, retryCount };
    } catch (error) {
      // Provider HTTP errors (4xx/5xx) should not be retried — rethrow immediately
      if (error instanceof OpenRouterError) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[generation-batch] Attempt ${attempt + 1} failed`, { model, error: lastError.message });
    }
  }

  throw new AiParseError(`AI returned an unparseable response after ${MAX_RETRIES + 1} attempts: ${lastError.message}`);
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
  questions: AiQuestion[],
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

/**
 * Orchestrates the full generation batch lifecycle:
 * rate-limit → insert pending → call AI → validate → dedup → insert → finalize → return DTO.
 *
 * Throws typed errors (`RateLimitError`, `AiParseError`) that the caller maps to HTTP status codes.
 */
export async function createGenerationBatch(
  command: CreateGenerationBatchCommand,
  userId: string,
  supabase: SupabaseClientType
): Promise<GenerationBatchSuccessDTO> {
  await checkRateLimit(userId, supabase);

  const batchId = await insertPendingBatch(command, userId, supabase);

  let questions: AiQuestion[];
  let estimatedCostUsd: number | null;
  let retryCount: number;

  try {
    ({ questions, estimatedCostUsd, retryCount } = await callAiWithRetry(
      command.provider,
      command.model,
      command.prompt_version,
      command.requested_questions_count
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finalizeBatch(batchId, { success: false, errorMessage: message, retryCount: MAX_RETRIES }, supabase);
    throw error;
  }

  let questionIds: string[];
  try {
    questionIds = await insertQuestionsAndCategories(questions, batchId, command.model, userId, supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finalizeBatch(batchId, { success: false, errorMessage: message, retryCount }, supabase);
    throw error;
  }

  const rounds = distributeToRounds(questionIds, QUESTIONS_PER_ROUND);
  const finishedAt = new Date().toISOString();

  await finalizeBatch(
    batchId,
    {
      success: true,
      returnedCount: questionIds.length,
      estimatedCostUsd,
      responsePayload: { rounds },
    },
    supabase
  );

  return {
    id: batchId,
    status: "success",
    returned_questions_count: questionIds.length,
    retry_count: retryCount,
    estimated_cost_usd: estimatedCostUsd,
    finished_at: finishedAt,
    rounds,
  };
}
