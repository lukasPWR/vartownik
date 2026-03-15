-- =============================================================================
-- Migration: 20260315000005_create_sessions_and_rounds.sql
-- Purpose  : Create the sessions and rounds tables that model the quiz
--            training workflow.
--            sessions – one training session per user run (default 4 rounds × 10 q)
--            rounds   – individual rounds within a session (1-based position)
-- Affected : sessions, rounds
-- Notes    : A AFTER INSERT trigger (added in 20260315000008_create_triggers.sql)
--            automatically transitions any existing in_progress session for the
--            user to 'abandoned' when a new session is created.
--            The check constraints on completed_at and abandoned_at enforce that
--            these timestamps are set whenever the status changes to the matching
--            terminal state.
--            rounds.ownership is derived from the parent session's user_id;
--            rls uses a subquery against sessions rather than a direct user_id column.
-- =============================================================================

-- ------------------------------------------------------------
-- table: sessions
-- ------------------------------------------------------------
create table sessions (
    id uuid primary key default gen_random_uuid (),
    user_id uuid not null references auth.users (id) on delete cascade,
    -- optional link to the ai generation batch that produced this session's questions
    generation_batch_id uuid null references generation_batches (id) on delete set null,
    status session_status_enum not null default 'in_progress',
    -- per-question timer in seconds for this session (copied from user_preferences at creation)
    timer_seconds smallint not null,
    total_rounds smallint not null default 4,
    questions_per_round smallint not null default 10,
    started_at timestamptz not null default now (),
    -- must be populated when status = 'completed'
    completed_at timestamptz null,
    -- must be populated when status = 'abandoned'
    abandoned_at timestamptz null,
    created_at timestamptz not null default now (),
    constraint chk_sessions_timer check (
        timer_seconds between 15 and 30
    ),
    constraint chk_sessions_total_rounds check (total_rounds > 0),
    constraint chk_sessions_questions_per_round check (questions_per_round > 0),
    -- completed_at must be set when status is 'completed'
    constraint chk_sessions_completed_at check (
        (
            status = 'completed'
            and completed_at is not null
        )
        or status <> 'completed'
    ),
    -- abandoned_at must be set when status is 'abandoned'
    constraint chk_sessions_abandoned_at check (
        (
            status = 'abandoned'
            and abandoned_at is not null
        )
        or status <> 'abandoned'
    )
);

-- index: filter by status ordered by start time (active session lookup, history view)
create
index ix_sessions_user_status_started on sessions (
    user_id,
    status,
    started_at desc
);

-- ------------------------------------------------------------
-- rls: sessions
-- ------------------------------------------------------------
alter table sessions enable row level security;

alter table sessions force row level security;

create policy "select_authenticated_own_rows" on sessions as permissive for
select to authenticated using (user_id = auth.uid ());

create policy "insert_authenticated_own_rows" on sessions as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

create policy "update_authenticated_own_rows" on sessions as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

create policy "delete_authenticated_own_rows" on sessions as permissive for
delete to authenticated using (user_id = auth.uid ());

create policy "select_anon_none" on sessions as restrictive for
select to anon using (false);

create policy "insert_anon_none" on sessions as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on sessions as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on sessions as restrictive for
delete to anon using (false);

-- ------------------------------------------------------------
-- table: rounds
-- One row per round within a session. Position is 1-based and
-- must be unique within a session (enforced by the table constraint).
-- The status column mirrors the session status vocabulary but is
-- constrained to 'in_progress' | 'completed' (rounds cannot be abandoned).
-- Ownership is expressed via the parent session's user_id.
-- ------------------------------------------------------------
create table rounds (
    id uuid primary key default gen_random_uuid (),
    session_id uuid not null references sessions (id) on delete cascade,
    -- 1-based ordinal of this round within the parent session
    position smallint not null,
    -- 'in_progress' while active; 'completed' once all attempts are recorded
    status text not null,
    started_at timestamptz not null default now (),
    -- populated when all questions in the round have been answered
    completed_at timestamptz null,
    created_at timestamptz not null default now (),
    constraint chk_rounds_status check (
        status in ('in_progress', 'completed')
    ),
    constraint chk_rounds_position check (position > 0),
    -- each position within a session may appear only once
    constraint uq_rounds_session_position unique (session_id, position)
);

-- index: retrieve rounds in position order for a given session (game loop)
create
index ix_rounds_session_position on rounds (session_id, position);

-- ------------------------------------------------------------
-- rls: rounds
-- Ownership is inferred from the parent session record; no direct
-- user_id column is present on rounds.
-- ------------------------------------------------------------
alter table rounds enable row level security;

alter table rounds force row level security;

-- authenticated: caller must own the parent session
create policy "select_authenticated_own_rows" on rounds as permissive for
select to authenticated using (
        exists (
            select 1
            from sessions s
            where
                s.id = session_id
                and s.user_id = auth.uid ()
        )
    );

create policy "insert_authenticated_own_rows" on rounds as permissive for
insert
    to authenticated
with
    check (
        exists (
            select 1
            from sessions s
            where
                s.id = session_id
                and s.user_id = auth.uid ()
        )
    );

create policy "update_authenticated_own_rows" on rounds as permissive for
update to authenticated using (
    exists (
        select 1
        from sessions s
        where
            s.id = session_id
            and s.user_id = auth.uid ()
    )
)
with
    check (
        exists (
            select 1
            from sessions s
            where
                s.id = session_id
                and s.user_id = auth.uid ()
        )
    );

create policy "delete_authenticated_own_rows" on rounds as permissive for
delete to authenticated using (
    exists (
        select 1
        from sessions s
        where
            s.id = session_id
            and s.user_id = auth.uid ()
    )
);

create policy "select_anon_none" on rounds as restrictive for
select to anon using (false);

create policy "insert_anon_none" on rounds as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on rounds as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on rounds as restrictive for
delete to anon using (false);