-- =============================================================================
-- Migration: 20260315000006_create_attempts.sql
-- Purpose  : Create the attempts table that records every answer attempt in a round.
-- Affected : attempts
-- Notes    : Contains full snapshots of the question and answer at the time of
--            the attempt so that historical results are not affected by later
--            edits to the source question.
--            The unique constraint on (round_id, position) ensures each position
--            within a round can only be attempted once.
-- =============================================================================

-- ------------------------------------------------------------
-- table: attempts
-- ------------------------------------------------------------
create table attempts (
  id                        bigint               generated always as identity primary key,
  created_at                timestamptz          not null default now(),
  user_id                   uuid                 not null references auth.users(id) on delete cascade,
  session_id                uuid                 not null references sessions(id)   on delete cascade,
  round_id                  uuid                 not null references rounds(id)     on delete cascade,
  -- on delete restrict: prevents accidental question deletion while attempts exist
  question_id               uuid                 not null references questions(id)  on delete restrict,
  -- 1-based position of this question within the round
  position                  smallint             not null,
  -- user's working notes visible while the timer runs
  scratchpad                text                 null,
  -- wall-clock time from question display to verdict submission (milliseconds)
  time_taken_ms             integer              not null,
  -- true when the configured timer expired before a verdict was submitted
  timer_expired             boolean              not null default false,
  -- user's self-assessed result; null only when timer_expired=true or scratchpad is set
  verdict                   attempt_verdict_enum null,
  -- true when the user flags this question for admin review
  is_flagged_by_user        boolean              not null default false,
  flag_reason               text                 null,
  -- immutable snapshots preserve question state at attempt time
  question_text_snapshot    text                 not null,
  correct_answer_snapshot   jsonb                not null,
  difficulty_score_snapshot smallint             not null,

-- each position within a round may appear only once
constraint uq_attempts_round_position
    unique (round_id, position),
  constraint chk_attempts_position
    check (position > 0),
  constraint chk_attempts_time_taken
    check (time_taken_ms >= 0),
  constraint chk_attempts_difficulty_snapshot
    check (difficulty_score_snapshot between 1 and 5),
  constraint chk_attempts_correct_answer_snapshot
    check (jsonb_typeof(correct_answer_snapshot) = 'object'),
  -- at least one of verdict, timer_expired, or scratchpad must be present
  constraint chk_attempts_verdict_or_timer_or_scratchpad
    check (verdict is not null or timer_expired = true or scratchpad is not null)
);

-- ------------------------------------------------------------
-- indexes
-- ------------------------------------------------------------

-- primary dashboard index: user's attempt timeline ordered by recency
create
index ix_attempts_user_created_at on attempts (user_id, created_at desc);

-- verdict-filtered analytics: e.g. "knew" rate per user over time
create
index ix_attempts_user_verdict_created on attempts (
    user_id,
    verdict,
    created_at desc
);

-- look up all attempts associated with a specific question
create index ix_attempts_question on attempts (question_id);

-- ------------------------------------------------------------
-- rls: attempts
-- ------------------------------------------------------------
alter table attempts enable row level security;

alter table attempts force row level security;

-- authenticated: users may read only their own attempt rows
create policy "select_authenticated_own_rows" on attempts as permissive for
select to authenticated using (user_id = auth.uid ());

-- authenticated: users may insert only rows keyed to themselves
create policy "insert_authenticated_own_rows" on attempts as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- authenticated: users may update only their own attempt rows
-- (e.g. setting is_flagged_by_user or flag_reason after submission)
create policy "update_authenticated_own_rows" on attempts as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

-- authenticated: users may delete only their own attempt rows
create policy "delete_authenticated_own_rows" on attempts as permissive for
delete to authenticated using (user_id = auth.uid ());

-- anon: no access to any attempt data
create policy "select_anon_none" on attempts as restrictive for
select to anon using (false);

create policy "insert_anon_none" on attempts as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on attempts as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on attempts as restrictive for
delete to anon using (false);