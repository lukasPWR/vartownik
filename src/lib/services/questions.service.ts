import { createHash } from "node:crypto";

import type { SupabaseClientType } from "@/db/supabase.client";
import { ConflictError, NotFoundError, StorageLimitError } from "@/lib/errors";
import type {
  CreateQuestionCommand,
  UpdateQuestionCommand,
  ListQuestionsResponseDTO,
  QuestionDTO,
  QuestionDetailDTO,
  QuestionEditHistoryDTO,
  CorrectAnswerDTO,
  CategoryRefDTO,
  GeneratedType,
  QuestionStatus,
} from "@/types";
import type { Tables } from "@/db/database.types";
import type { ListQuestionsQuery } from "@/pages/api/questions/index";

const SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  created_at_desc: { column: "created_at", ascending: false },
  created_at_asc: { column: "created_at", ascending: true },
  difficulty_asc: { column: "difficulty_score", ascending: true },
  difficulty_desc: { column: "difficulty_score", ascending: false },
};

/**
 * Returns a paginated, filtered, and sorted list of questions owned by the given user.
 * Includes nested category and tag references.
 */
export async function listQuestions(
  supabase: SupabaseClientType,
  userId: string,
  params: ListQuestionsQuery
): Promise<ListQuestionsResponseDTO> {
  const { page, limit, status, generated_type, category_id, tag_id, difficulty_score, q, sort } = params;
  const offset = (page - 1) * limit;

  // Use !inner join when filtering by relation to exclude non-matching parent rows
  const categoriesJoin = category_id ? "question_categories!inner" : "question_categories";
  const tagsJoin = tag_id ? "question_tags!inner" : "question_tags";

  const selectClause = `
    id, generated_type, status, question_text, correct_answer,
    difficulty_score, image_path, source_model, created_at,
    ${categoriesJoin}(category_id, categories(id, name)),
    ${tagsJoin}(tag_id, tags(id, name))
  `;

  let query = supabase.from("questions").select(selectClause, { count: "exact" }).eq("user_id", userId);

  if (status) query = query.eq("status", status);
  if (generated_type) query = query.eq("generated_type", generated_type);
  if (difficulty_score) query = query.eq("difficulty_score", difficulty_score);
  if (category_id) query = query.eq("question_categories.category_id", category_id);
  if (tag_id) query = query.eq("question_tags.tag_id", tag_id);
  if (q) query = query.textSearch("search_vector", q, { type: "websearch" });

  const { column, ascending } = SORT_MAP[sort];
  query = query.order(column, { ascending });
  query = query.range(offset, offset + limit - 1);

  const { data: rawData, count, error } = await query;

  if (error) throw error;

  // Explicit type needed because Supabase cannot infer from a dynamic template-literal select string
  interface RawRow {
    id: string;
    generated_type: GeneratedType;
    status: QuestionStatus;
    question_text: string;
    correct_answer: unknown;
    difficulty_score: number;
    image_path: string | null;
    source_model: string | null;
    created_at: string;
    question_categories: { category_id: string; categories: CategoryRefDTO | null }[];
    question_tags: { tag_id: string; tags: Pick<Tables<"tags">, "id" | "name"> | null }[];
  }

  const data = (rawData ?? []) as unknown as RawRow[];

  const mapped: QuestionDTO[] = data.map((row) => ({
    id: row.id,
    generated_type: row.generated_type,
    status: row.status,
    question_text: row.question_text,
    correct_answer: row.correct_answer as CorrectAnswerDTO,
    difficulty_score: row.difficulty_score,
    image_path: row.image_path,
    source_model: row.source_model,
    created_at: row.created_at,
    categories: (row.question_categories ?? []).map((qc) => qc.categories).filter(Boolean) as CategoryRefDTO[],
    tags: (row.question_tags ?? []).map((qt) => qt.tags).filter(Boolean) as Pick<Tables<"tags">, "id" | "name">[],
  }));

  return {
    data: mapped,
    pagination: { page, limit, total: count ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// createQuestion — manual question creation
// ---------------------------------------------------------------------------

/**
 * Creates a manual question for the given user, enforcing storage limit and
 * duplicate-content checks. Returns the full QuestionDTO on success.
 *
 * @throws {StorageLimitError} when the user has reached their question storage limit.
 * @throws {ConflictError} when a question with identical content already exists.
 */
export async function createQuestion(
  supabase: SupabaseClientType,
  userId: string,
  command: CreateQuestionCommand
): Promise<QuestionDTO> {
  // Step A: check storage limit
  const [{ data: prefs }, { count }] = await Promise.all([
    supabase.from("user_preferences").select("storage_limit_questions").eq("user_id", userId).maybeSingle(),
    supabase.from("questions").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  const storageLimit = prefs?.storage_limit_questions;
  if (storageLimit != null && (count ?? 0) >= storageLimit) {
    throw new StorageLimitError("Question storage limit reached.");
  }

  // Step B: compute content hash to detect duplicates (server-side, not user-supplied)
  const content_hash = createHash("sha256").update(`${userId}::${command.question_text.trim()}`).digest("hex");

  // Step C: insert the question row
  const { data: inserted, error: insertError } = await supabase
    .from("questions")
    .insert({
      user_id: userId,
      question_text: command.question_text,
      correct_answer: command.correct_answer as unknown as import("@/db/database.types").Json,
      difficulty_score: command.difficulty_score,
      image_path: command.image_path ?? null,
      content_hash,
      generated_type: "manual" as GeneratedType,
      status: "active" as QuestionStatus,
      source_model: null,
    })
    .select("id, created_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new ConflictError("A question with this content already exists.");
    }
    if (insertError.code === "23503") {
      throw Object.assign(new Error("One or more category_ids or tag_ids are invalid."), { code: "FK_VIOLATION" });
    }
    throw insertError;
  }

  const { id } = inserted;

  // Step D: batch-insert junction rows
  if (command.category_ids.length > 0) {
    const { error: catError } = await supabase
      .from("question_categories")
      .insert(command.category_ids.map((category_id) => ({ question_id: id, category_id })));
    if (catError) throw catError;
  }

  if (command.tag_ids.length > 0) {
    const { error: tagError } = await supabase
      .from("question_tags")
      .insert(command.tag_ids.map((tag_id) => ({ question_id: id, tag_id })));
    if (tagError) throw tagError;
  }

  // Step E: fetch the full row with relations for the response DTO
  interface RawRow {
    id: string;
    generated_type: GeneratedType;
    status: QuestionStatus;
    question_text: string;
    correct_answer: unknown;
    difficulty_score: number;
    image_path: string | null;
    source_model: string | null;
    created_at: string;
    question_categories: { categories: CategoryRefDTO | null }[];
    question_tags: { tags: Pick<Tables<"tags">, "id" | "name"> | null }[];
  }

  const { data: row, error: fetchError } = await supabase
    .from("questions")
    .select(
      `id, generated_type, status, question_text, correct_answer,
       difficulty_score, image_path, source_model, created_at,
       question_categories(categories(id, name)),
       question_tags(tags(id, name))`
    )
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  const typedRow = row as unknown as RawRow;

  return {
    id: typedRow.id,
    generated_type: typedRow.generated_type,
    status: typedRow.status,
    question_text: typedRow.question_text,
    correct_answer: typedRow.correct_answer as CorrectAnswerDTO,
    difficulty_score: typedRow.difficulty_score,
    image_path: typedRow.image_path,
    source_model: typedRow.source_model,
    created_at: typedRow.created_at,
    categories: (typedRow.question_categories ?? []).map((qc) => qc.categories).filter(Boolean) as CategoryRefDTO[],
    tags: (typedRow.question_tags ?? []).map((qt) => qt.tags).filter(Boolean) as Pick<Tables<"tags">, "id" | "name">[],
  };
}

// ---------------------------------------------------------------------------
// getQuestionById — single question detail with edit history
// ---------------------------------------------------------------------------

/**
 * Returns a single question (with categories, tags, and edit history)
 * owned by the given user.
 *
 * @throws {NotFoundError} when no question with the given id exists for this user.
 */
export async function getQuestionById(
  supabase: SupabaseClientType,
  userId: string,
  id: string
): Promise<QuestionDetailDTO> {
  const { data: row, error } = await supabase
    .from("questions")
    .select(
      `id, generated_type, status, question_text, correct_answer,
       difficulty_score, image_path, source_model, created_at, updated_at,
       question_categories(categories(id, name)),
       question_tags(tags(id, name)),
       question_edits(id, change_reason, created_at)`
    )
    .eq("id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false, referencedTable: "question_edits" })
    .single();

  // PGRST116 = PostgREST "no rows returned" for .single()
  if (error?.code === "PGRST116" || !row) throw new NotFoundError("Question not found.");
  if (error) throw error;

  interface RawRow {
    id: string;
    generated_type: GeneratedType;
    status: QuestionStatus;
    question_text: string;
    correct_answer: unknown;
    difficulty_score: number;
    image_path: string | null;
    source_model: string | null;
    created_at: string;
    updated_at: string;
    question_categories: { categories: CategoryRefDTO | null }[];
    question_tags: { tags: Pick<Tables<"tags">, "id" | "name"> | null }[];
    question_edits: QuestionEditHistoryDTO[];
  }

  const typedRow = row as unknown as RawRow;

  return {
    id: typedRow.id,
    generated_type: typedRow.generated_type,
    status: typedRow.status,
    question_text: typedRow.question_text,
    correct_answer: typedRow.correct_answer as CorrectAnswerDTO,
    difficulty_score: typedRow.difficulty_score,
    image_path: typedRow.image_path,
    source_model: typedRow.source_model,
    created_at: typedRow.created_at,
    updated_at: typedRow.updated_at,
    categories: typedRow.question_categories.map((qc) => qc.categories).filter((c): c is CategoryRefDTO => c !== null),
    tags: typedRow.question_tags
      .map((qt) => qt.tags)
      .filter((t): t is Pick<Tables<"tags">, "id" | "name"> => t !== null),
    edit_history: typedRow.question_edits ?? [],
  };
}

// ---------------------------------------------------------------------------
// updateQuestion — partial update with audit trail
// ---------------------------------------------------------------------------

/**
 * Partially updates a question owned by the given user and records an audit entry.
 * Relations (categories, tags) are fully replaced when their id arrays are provided.
 *
 * @throws {Error} with code "NO_FIELDS" when no updatable field is provided.
 * @throws {NotFoundError} when the question does not exist or belongs to another user.
 * @throws {Error} with code "INVALID_RELATION_IDS" when a FK violation occurs.
 */
export async function updateQuestion(
  supabase: SupabaseClientType,
  userId: string,
  id: string,
  command: UpdateQuestionCommand
): Promise<QuestionDetailDTO> {
  const { question_text, correct_answer, difficulty_score, status, category_ids, tag_ids, change_reason } = command;

  const hasUpdatableFields =
    question_text !== undefined ||
    correct_answer !== undefined ||
    difficulty_score !== undefined ||
    status !== undefined ||
    category_ids !== undefined ||
    tag_ids !== undefined;

  if (!hasUpdatableFields) {
    throw Object.assign(new Error("No fields to update provided"), { code: "NO_FIELDS" });
  }

  // Fetch current state — also validates ownership (throws NotFoundError if not found)
  const currentQuestion = await getQuestionById(supabase, userId, id);

  // Build the direct-column update payload
  const updatePayload: Record<string, unknown> = {};
  if (question_text !== undefined) updatePayload.question_text = question_text;
  if (correct_answer !== undefined) {
    // Merge partial correct_answer with existing value
    updatePayload.correct_answer = { ...currentQuestion.correct_answer, ...correct_answer };
  }
  if (difficulty_score !== undefined) updatePayload.difficulty_score = difficulty_score;
  if (status !== undefined) updatePayload.status = status;

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateError } = await supabase
      .from("questions")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId);
    if (updateError) throw updateError;
  }

  // Sync categories — full replace when array is provided
  if (category_ids !== undefined) {
    const { error: delCatError } = await supabase.from("question_categories").delete().eq("question_id", id);
    if (delCatError) throw delCatError;

    if (category_ids.length > 0) {
      const { error: insCatError } = await supabase
        .from("question_categories")
        .insert(category_ids.map((category_id) => ({ question_id: id, category_id })));
      if (insCatError) {
        if (insCatError.code === "23503") {
          throw Object.assign(new Error("One or more category_ids are invalid."), { code: "INVALID_RELATION_IDS" });
        }
        throw insCatError;
      }
    }
  }

  // Sync tags — full replace when array is provided
  if (tag_ids !== undefined) {
    const { error: delTagError } = await supabase.from("question_tags").delete().eq("question_id", id);
    if (delTagError) throw delTagError;

    if (tag_ids.length > 0) {
      const { error: insTagError } = await supabase
        .from("question_tags")
        .insert(tag_ids.map((tag_id) => ({ question_id: id, tag_id })));
      if (insTagError) {
        if (insTagError.code === "23503") {
          throw Object.assign(new Error("One or more tag_ids are invalid."), { code: "INVALID_RELATION_IDS" });
        }
        throw insTagError;
      }
    }
  }

  // Insert audit record
  const { error: auditError } = await supabase.from("question_edits").insert({
    question_id: id,
    user_id: userId,
    change_reason,
    old_payload: currentQuestion as unknown as import("@/db/database.types").Json,
    new_payload: { ...updatePayload, category_ids, tag_ids } as unknown as import("@/db/database.types").Json,
  });
  if (auditError) throw auditError;

  return getQuestionById(supabase, userId, id);
}

// ---------------------------------------------------------------------------
// deleteQuestion — hard delete with attempt guard
// ---------------------------------------------------------------------------

/**
 * Permanently deletes a question owned by the given user.
 * Cascades to question_categories, question_tags, and question_edits via DB FK.
 *
 * @throws {NotFoundError} when no question with the given id exists for this user.
 * @throws {ConflictError} when the question has associated attempt records.
 */
export async function deleteQuestion(supabase: SupabaseClientType, userId: string, id: string): Promise<void> {
  // Step 1: Verify question exists and belongs to the user
  const { data: question, error: findError } = await supabase
    .from("questions")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (findError) throw findError;
  if (!question) throw new NotFoundError("Question not found.");

  // Step 2: Guard against deletion when attempts exist
  const { count, error: countError } = await supabase
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("question_id", id);

  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new ConflictError(
      'Cannot delete a question that has associated attempts. Use PATCH with status: "archived" instead.'
    );
  }

  // Step 3: Hard delete — cascades to question_categories, question_tags, question_edits
  const { error: deleteError } = await supabase.from("questions").delete().eq("id", id).eq("user_id", userId);

  if (deleteError) throw deleteError;
}
