-- =============================================================================
-- Migration: 20260315000002_create_categories_and_tags.sql
-- Purpose  : Create the categories and tags tables used to classify questions.
--            categories – structured thematic hierarchy (required for question
--              assignment; linked via question_categories join table).
--            tags – optional free-form labels for flexible filtering alongside
--              the stricter category hierarchy.
-- Affected : categories, tags
-- Notes    : Both tables share the same ownership model (user_id = auth.uid()).
--            Tags and their join table (question_tags) are an optional module
--            and can be disabled without breaking the core schema.
-- =============================================================================

-- ------------------------------------------------------------
-- table: categories
-- Each user has their own namespace of categories; slug and name
-- must be unique per user (name is compared case-insensitively).
-- ------------------------------------------------------------
create table categories (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  -- machine-readable identifier; unique per user
  slug        text        not null,
  description text        null,
  created_at  timestamptz not null default now(),

-- name must be between 2 and 120 characters
constraint chk_categories_name_length
    check (char_length(name) between 2 and 120),
  -- slug uniqueness is enforced by the table constraint (b-tree);
  -- name uniqueness (ci) is enforced below by a functional unique index
  constraint uq_categories_user_slug
    unique (user_id, slug)
);

-- functional unique index: case-insensitive name uniqueness per user
-- (cannot be expressed as a table CHECK constraint)
create unique
index ux_categories_user_name_ci on categories (user_id, lower(name));

-- ------------------------------------------------------------
-- rls: categories
-- ------------------------------------------------------------
alter table categories enable row level security;

alter table categories force row level security;

create policy "select_authenticated_own_rows" on categories as permissive for
select to authenticated using (user_id = auth.uid ());

create policy "insert_authenticated_own_rows" on categories as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

create policy "update_authenticated_own_rows" on categories as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

create policy "delete_authenticated_own_rows" on categories as permissive for
delete to authenticated using (user_id = auth.uid ());

create policy "select_anon_none" on categories as restrictive for
select to anon using (false);

create policy "insert_anon_none" on categories as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on categories as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on categories as restrictive for
delete to anon using (false);

-- ------------------------------------------------------------
-- table: tags
-- Optional free-form labels for questions. Tag names are unique
-- per user (case-insensitive), enforced by a functional index.
-- The unique constraint is a functional index (not an inline
-- constraint) because inline check constraints cannot call lower().
-- ------------------------------------------------------------
create table tags (
    id uuid primary key default gen_random_uuid (),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now ()
);

-- functional unique index: case-insensitive tag name per user
create unique
index ux_tags_user_name_ci on tags (user_id, lower(name));

-- ------------------------------------------------------------
-- rls: tags
-- ------------------------------------------------------------
alter table tags enable row level security;

alter table tags force row level security;

create policy "select_authenticated_own_rows" on tags as permissive for
select to authenticated using (user_id = auth.uid ());

create policy "insert_authenticated_own_rows" on tags as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

create policy "update_authenticated_own_rows" on tags as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

create policy "delete_authenticated_own_rows" on tags as permissive for
delete to authenticated using (user_id = auth.uid ());

create policy "select_anon_none" on tags as restrictive for
select to anon using (false);

create policy "insert_anon_none" on tags as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on tags as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on tags as restrictive for
delete to anon using (false);