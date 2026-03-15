-- =============================================================================
-- Migration: 20260315000001_create_user_preferences.sql
-- Purpose  : Create the user_preferences table that stores per-user
--            application settings, timer configuration, category weights
--            for random question sampling, and storage quotas.
-- Affected : user_preferences
-- Notes    : One row per auth.users row, typically created at registration.
--            The storage_limit_questions column is read by a trigger in the
--            questions migration to enforce per-user quotas.
-- =============================================================================

-- ------------------------------------------------------------
-- table: user_preferences
-- One-to-one with auth.users; cascades on user deletion so that
-- no orphaned settings rows can accumulate.
-- ------------------------------------------------------------
create table user_preferences (
    user_id uuid primary key references auth.users (id) on delete cascade,
    -- jsonb map of { category_id: weight } used when randomly sampling questions;
    -- must always be a json object, never an array or scalar
    category_weights jsonb not null default '{}'::jsonb,
    -- timer duration per question in seconds (business rule: 15–30 s)
    default_timer_seconds smallint not null default 20,
    -- maximum number of questions this user may store (enforced by trigger)
    storage_limit_questions integer not null default 5000,
    -- maximum bytes for the user's quiz-images storage folder (default 1 GiB)
    storage_limit_images_bytes bigint not null default 1073741824,
    created_at timestamptz not null default now (),
    updated_at timestamptz not null default now (),
    constraint chk_user_prefs_timer check (
        default_timer_seconds between 15 and 30
    ),
    constraint chk_user_prefs_storage_questions check (storage_limit_questions > 0),
    constraint chk_user_prefs_storage_images check (
        storage_limit_images_bytes > 0
    ),
    constraint chk_user_prefs_category_weights_type check (
        jsonb_typeof (category_weights) = 'object'
    )
);

-- ------------------------------------------------------------
-- row level security
-- ------------------------------------------------------------
alter table user_preferences enable row level security;

alter table user_preferences force row level security;

-- authenticated: each user may read only their own preferences row
create policy "select_authenticated_own_rows" on user_preferences as permissive for
select to authenticated using (user_id = auth.uid ());

-- authenticated: each user may insert only a row keyed to themselves
create policy "insert_authenticated_own_rows" on user_preferences as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- authenticated: each user may update only their own preferences row
create policy "update_authenticated_own_rows" on user_preferences as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

-- authenticated: each user may delete only their own preferences row
create policy "delete_authenticated_own_rows" on user_preferences as permissive for
delete to authenticated using (user_id = auth.uid ());

-- anon: no read access — preferences contain private configuration
create policy "select_anon_none" on user_preferences as restrictive for
select to anon using (false);

-- anon: no insert access
create policy "insert_anon_none" on user_preferences as restrictive for
insert
    to anon
with
    check (false);

-- anon: no update access
create policy "update_anon_none" on user_preferences as restrictive for
update to anon using (false)
with
    check (false);

-- anon: no delete access
create policy "delete_anon_none" on user_preferences as restrictive for
delete to anon using (false);