import { createHash } from "node:crypto";

import type { SupabaseClientType } from "@/db/supabase.client";
import { ConflictError, StorageLimitError } from "@/lib/errors";
import type {
  CreateQuestionCommand,
  ListQuestionsResponseDTO,
  QuestionDTO,
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
