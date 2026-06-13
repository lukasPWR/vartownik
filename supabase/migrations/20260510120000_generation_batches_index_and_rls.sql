-- =============================================================================
-- Migration: generation_batches_index_and_rls
-- Purpose:   Add a composite index for point-lookup by (id, user_id) on the
--            generation_batches table used by GET /api/generation-batches/:id.
--            Also enables RLS with granular per-operation policies so the
--            user_id filter acts as a second line of defence even if the
--            service layer is bypassed.
-- Affected tables: generation_batches
-- Notes:     All DDL uses IF NOT EXISTS / IF NOT EXISTS guards so the
--            migration is safe to re-run in CI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Performance index — point-lookup for GET /api/generation-batches/:id
-- ---------------------------------------------------------------------------

-- Composite index supports: WHERE id = :id AND user_id = :userId
create
index if not exists idx_generation_batches_id_user_id on generation_batches (id, user_id);

-- Supporting index for list queries filtered + sorted by user
create
index if not exists idx_generation_batches_user_id_created_at on generation_batches (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table generation_batches enable row level security;

-- SELECT: users may only read their own batches
create policy "generation_batches_select_own" on generation_batches for
select to authenticated using (user_id = auth.uid ());

-- INSERT: users may only create batches for themselves
create policy "generation_batches_insert_own" on generation_batches for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- UPDATE: users may only update their own batches (e.g. status transitions)
create policy "generation_batches_update_own" on generation_batches for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());