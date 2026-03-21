import type { SupabaseClientType } from "@/db/supabase.client";
import { ConflictError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import type { CategoryDTO, CreateCategoryCommand } from "@/types";

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
