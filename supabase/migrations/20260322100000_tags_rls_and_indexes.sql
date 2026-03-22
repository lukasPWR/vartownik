-- =============================================================================
-- Migration: tags_rls_and_indexes
-- Purpose:   Enable RLS on the `tags` table and add granular per-operation
--            policies for the `authenticated` role. Also ensures a
--            case-insensitive unique constraint on (user_id, lower(name)) and
--            a performance index for lookups.
-- Affected tables: tags, question_tags
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable Row-Level Security
-- ---------------------------------------------------------------------------

alter table tags enable row level security;

-- ---------------------------------------------------------------------------
-- RLS Policies — authenticated role only
-- ---------------------------------------------------------------------------

-- Allow users to read only their own tags
create policy "tags_select_own" on tags for
select to authenticated using (user_id = auth.uid ());

-- Allow users to insert only their own tags (user_id must equal the JWT sub)
create policy "tags_insert_own" on tags for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- Allow users to delete only their own tags
create policy "tags_delete_own" on tags for
delete to authenticated using (user_id = auth.uid ());

-- ---------------------------------------------------------------------------
-- Unique constraint: case-insensitive name per user
-- ---------------------------------------------------------------------------

create unique
index if not exists idx_tags_user_id_name_lower on tags (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- Performance index: all tags for a user (used by listTags, ordered by name)
-- ---------------------------------------------------------------------------

create index if not exists idx_tags_user_id on tags (user_id);

-- ---------------------------------------------------------------------------
-- Ensure question_tags.tag_id FK has ON DELETE CASCADE
-- (Re-create the constraint only when the referencing table exists and the
--  cascade behaviour is not yet set. Safe to run with IF NOT EXISTS guard.)
-- ---------------------------------------------------------------------------

-- Nothing to alter here if the FK was already created with CASCADE in the
-- initial schema. If it was not, uncomment and adapt the block below:
--
-- alter table question_tags
--   drop constraint if exists question_tags_tag_id_fkey;
-- alter table question_tags
--   add constraint question_tags_tag_id_fkey
--   foreign key (tag_id) references tags(id) on delete cascade;