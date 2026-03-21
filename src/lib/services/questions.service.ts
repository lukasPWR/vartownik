import type { SupabaseClientType } from "@/db/supabase.client";
import type {
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
