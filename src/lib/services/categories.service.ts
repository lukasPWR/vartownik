import { z } from "zod";

import type { SupabaseClientType } from "@/db/supabase.client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import type { CategoryDTO, CreateCategoryCommand, ListCategoriesResponseDTO, UpdateCategoryCommand } from "@/types";

// ---------------------------------------------------------------------------
// List categories
// ---------------------------------------------------------------------------

const ListCategoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["name_asc", "created_at_desc"]).default("name_asc"),
});

export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;

export { ListCategoriesQuerySchema };

const SORT_MAP: Record<ListCategoriesQuery["sort"], { column: string; ascending: boolean }> = {
  name_asc: { column: "name", ascending: true },
  created_at_desc: { column: "created_at", ascending: false },
};

/**
 * Returns a paginated list of categories belonging to the authenticated user.
 * RLS on the `categories` table automatically scopes results to `auth.uid()`.
 */
export async function listCategories(
  supabase: SupabaseClientType,
  query: ListCategoriesQuery
): Promise<ListCategoriesResponseDTO> {
  const { page, limit, sort } = query;
  const { column, ascending } = SORT_MAP[sort];
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from("categories")
    .select("id, name, slug, description, created_at", { count: "exact" })
    .order(column, { ascending })
    .range(offset, offset + limit - 1);

  if (error) {
    throw error;
  }

  return {
    data: (data ?? []) as CategoryDTO[],
    pagination: { page, limit, total: count ?? 0 },
  };
}

/**
 * Inserts a new category for the given user.
 * The slug is derived server-side from `command.name` via `slugify`.
 * Throws `ConflictError` when a category with the same slug already exists for that user.
 */
export async function createCategory(
  supabase: SupabaseClientType,
  userId: string,
  command: CreateCategoryCommand
): Promise<CategoryDTO> {
  const slug = slugify(command.name);

  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: userId,
      name: command.name,
      slug,
      description: command.description ?? null,
    })
    .select("id, name, slug, description, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ConflictError(`Category with slug "${slug}" already exists.`);
    }
    throw error;
  }

  return data as CategoryDTO;
}

// ---------------------------------------------------------------------------
// Get category by ID
// ---------------------------------------------------------------------------

/**
 * Returns a single category by its UUID.
 * RLS on the `categories` table scopes the query to `auth.uid()`,
 * so a user can never retrieve another user's category even with a valid UUID.
 * Throws `NotFoundError` when no matching row is found.
 */
export async function getCategoryById(supabase: SupabaseClientType, id: string): Promise<CategoryDTO> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, description, created_at")
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116 = "exact one row expected but got 0" — treat as not found
    if (error.code === "PGRST116") {
      throw new NotFoundError("Category not found.");
    }
    throw error;
  }

  if (!data) {
    throw new NotFoundError("Category not found.");
  }

  return data as CategoryDTO;
}

// ---------------------------------------------------------------------------
// Update category (PATCH)
// ---------------------------------------------------------------------------

/**
 * Zod schema for PATCH /api/categories/:id request body.
 * Both fields are optional, but at least one must be provided.
 */
export const UpdateCategoryBodySchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: "At least one of 'name' or 'description' must be provided.",
  });

/**
 * Partially updates a category's `name` and/or `description`.
 * When `name` is provided, a new `slug` is derived server-side via `slugify`.
 * RLS on the `categories` table scopes the UPDATE to the authenticated user,
 * so rows belonging to other users return 0 updated rows (PGRST116 → 404).
 *
 * @throws {NotFoundError} when the category does not exist or belongs to another user
 * @throws {ConflictError} when the new slug conflicts with an existing category
 */
export async function updateCategory(
  supabase: SupabaseClientType,
  id: string,
  command: UpdateCategoryCommand
): Promise<CategoryDTO> {
  const updatePayload: Record<string, unknown> = {};

  if (command.name !== undefined) {
    updatePayload.name = command.name;
    updatePayload.slug = slugify(command.name);
  }

  if (command.description !== undefined) {
    updatePayload.description = command.description;
  }

  const { data, error } = await supabase
    .from("categories")
    .update(updatePayload)
    .eq("id", id)
    .select("id, name, slug, description, created_at")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("Category not found.");
    }
    if (error.code === "23505") {
      throw new ConflictError(`Category with slug "${updatePayload.slug}" already exists.`);
    }
    throw error;
  }

  return data as CategoryDTO;
}

// ---------------------------------------------------------------------------
// Delete category
// ---------------------------------------------------------------------------

/**
 * Deletes a category and all associated question_categories rows.
 * RLS on `categories` scopes the DELETE to auth.uid(), so deleting a
 * non-existent or foreign category results in 0 rows deleted → NotFoundError.
 *
 * @throws {NotFoundError} when the category does not exist or belongs to another user
 */
export async function deleteCategory(supabase: SupabaseClientType, id: string): Promise<void> {
  // 1. Remove associations first to avoid FK constraint violations.
  const { error: assocError } = await supabase.from("question_categories").delete().eq("category_id", id);

  if (assocError) {
    throw assocError;
  }

  // 2. Delete the category itself; RLS enforces ownership.
  const { error, count } = await supabase.from("categories").delete({ count: "exact" }).eq("id", id);

  if (error) {
    throw error;
  }

  if ((count ?? 0) === 0) {
    throw new NotFoundError("Category not found.");
  }
}
