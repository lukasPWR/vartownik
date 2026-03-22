import type { SupabaseClientType } from "@/db/supabase.client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { CreateTagCommand, ListTagsResponseDTO, TagDTO } from "@/types";

// ---------------------------------------------------------------------------
// List tags
// ---------------------------------------------------------------------------

/**
 * Returns all tags belonging to the authenticated user, ordered by name.
 * RLS on the `tags` table automatically scopes results to `auth.uid()`.
 */
export async function listTags(supabase: SupabaseClientType): Promise<ListTagsResponseDTO> {
  const { data, error } = await supabase.from("tags").select("id, name, created_at").order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return { data: (data ?? []) as TagDTO[] };
}

// ---------------------------------------------------------------------------
// Create tag
// ---------------------------------------------------------------------------

/**
 * Inserts a new tag for the given user.
 * The `user_id` is always taken from the trusted session, never from the request body.
 * Throws `ConflictError` when a tag with the same name (case-insensitive) already
 * exists for that user — DB unique index on `(user_id, lower(name))` triggers code `23505`.
 */
export async function createTag(
  supabase: SupabaseClientType,
  userId: string,
  command: CreateTagCommand
): Promise<TagDTO> {
  const { data, error } = await supabase
    .from("tags")
    .insert({ user_id: userId, name: command.name })
    .select("id, name, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ConflictError("Tag with this name already exists.");
    }
    throw error;
  }

  return data as TagDTO;
}

// ---------------------------------------------------------------------------
// Delete tag
// ---------------------------------------------------------------------------

/**
 * Deletes a tag owned by the given user.
 * Filters by both `id` and `user_id` as defence-in-depth alongside RLS.
 * Throws `NotFoundError` when no row matched (tag doesn't exist or belongs to another user).
 * Cascade FK on `question_tags.tag_id` removes all related `question_tags` rows automatically.
 */
export async function deleteTag(supabase: SupabaseClientType, userId: string, id: string): Promise<void> {
  const { count, error } = await supabase.from("tags").delete({ count: "exact" }).eq("id", id).eq("user_id", userId);

  if (error) {
    throw error;
  }

  if (!count || count === 0) {
    throw new NotFoundError("Tag not found.");
  }
}
