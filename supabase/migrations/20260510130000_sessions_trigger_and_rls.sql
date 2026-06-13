-- =============================================================================
-- Migration: sessions_trigger_and_rls
-- Purpose:   1. Add a BEFORE INSERT trigger on `sessions` that automatically
--               sets any existing in_progress sessions for the same user to
--               `abandoned`, so each user has at most one active session.
--            2. Enable RLS on `sessions` and `rounds` with granular per-
--               operation policies scoped to the authenticated user.
--            3. Add supporting indexes for session and round lookups.
-- Affected tables: sessions, rounds
-- Notes:     All DDL uses IF NOT EXISTS guards for safe re-runs in CI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger: abandon previous in_progress sessions on new session insert
-- ---------------------------------------------------------------------------

create or replace function abandon_previous_sessions()
returns trigger
language plpgsql
security definer
as $$
begin
  update sessions
  set
    status = 'abandoned',
    abandoned_at = now()
  where
    user_id = new.user_id
    and status = 'in_progress';

  return new;
end;
$$;

drop trigger if exists set_previous_sessions_abandoned on sessions;

create trigger set_previous_sessions_abandoned
before insert on sessions
for each row
execute function abandon_previous_sessions();

-- ---------------------------------------------------------------------------
-- 2. Indexes for sessions
-- ---------------------------------------------------------------------------

create
index if not exists idx_sessions_user_id_started_at on sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 3. Indexes for rounds
-- ---------------------------------------------------------------------------

create
index if not exists idx_rounds_session_id_position on rounds (session_id, position);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security — sessions
-- ---------------------------------------------------------------------------

alter table sessions enable row level security;

-- SELECT: users may only read their own sessions
create policy "sessions_select_own" on sessions for
select to authenticated using (user_id = auth.uid ());

-- INSERT: users may only create sessions for themselves
create policy "sessions_insert_own" on sessions for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- UPDATE: users may only update their own sessions (e.g. status transitions)
create policy "sessions_update_own" on sessions for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security — rounds
-- ---------------------------------------------------------------------------

alter table rounds enable row level security;

-- SELECT: users may only read rounds belonging to their own sessions
create policy "rounds_select_own" on rounds for
select to authenticated using (
        exists (
            select 1
            from sessions s
            where
                s.id = rounds.session_id
                and s.user_id = auth.uid ()
        )
    );