-- =============================================================================
-- Migration: 20260315000008_create_triggers.sql
-- Purpose  : Create all trigger functions and triggers that enforce core
--            business rules across the schema.
-- Affected : sessions, questions, attempts (trigger targets)
-- Notes    : All functions use SECURITY DEFINER with an explicit SET search_path
--            to prevent search_path injection attacks (OWASP A05 / CWE-89).
--            Functions are created with CREATE OR REPLACE so this migration can
--            be re-applied safely without dropping dependent triggers first.
--
--   Triggers defined here:
--     1. trg_abandon_stale_sessions (AFTER INSERT on sessions)
--        – auto-transitions any existing in_progress session for the user to
--          'abandoned' when a new session is created; enforces the one-active-
--          session-per-user business rule.
--
--     2. trg_flag_question_for_review (AFTER INSERT OR UPDATE on attempts)
--        – when is_flagged_by_user = true on an attempt, automatically sets
--          the referenced question's status to 'needs_review' (unless it is
--          already in a more terminal state such as 'archived').
--
--     3. trg_check_question_storage_limit (BEFORE INSERT on questions)
--        – reads the caller's storage_limit_questions from user_preferences
--          and raises an exception if the current question count would exceed it.
-- =============================================================================

-- ============================================================
-- 1. fn_abandon_stale_sessions / trg_abandon_stale_sessions
-- ============================================================

-- trigger function: abandon any in_progress sessions when a new one is created
-- fires AFTER INSERT so that new.id is available and can be excluded from the
-- update to prevent the newly inserted session from abandoning itself
create or replace function fn_abandon_stale_sessions()
  returns trigger
  language plpgsql
  security definer
  -- explicit search_path prevents malicious schema injection
  set search_path = public, pg_temp
as $$
begin
  -- mark all prior in_progress sessions for this user as abandoned,
  -- excluding the session row that just triggered this call
  update sessions
  set
    status       = 'abandoned',
    abandoned_at = now()
  where user_id  = new.user_id
    and status   = 'in_progress'
    and id      <> new.id;

  return new;
end;
$$;

create trigger trg_abandon_stale_sessions
  after insert on sessions
  for each row
  execute function fn_abandon_stale_sessions();

-- ============================================================
-- 2. fn_flag_question_for_review / trg_flag_question_for_review
-- ============================================================

-- trigger function: elevate a question's status to 'needs_review' when a user
-- flags an attempt as potentially incorrect.
-- fires AFTER INSERT OR UPDATE OF is_flagged_by_user on attempts so that
-- both initial flags and subsequent flag updates are captured.
-- because attempts is a partitioned table, the trigger is defined on the parent;
-- postgresql automatically applies it to all existing and future child partitions.
create or replace function fn_flag_question_for_review()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  -- only act when the flag is explicitly set on the incoming row
  if new.is_flagged_by_user = true then
    update questions
    set status = 'needs_review'
    where id = new.question_id
      -- do not overwrite a more terminal state (needs_review or archived)
      and status not in ('needs_review', 'archived');
  end if;

  return new;
end;
$$;

create trigger trg_flag_question_for_review
  after insert or update of is_flagged_by_user on attempts
  for each row
  execute function fn_flag_question_for_review();

-- ============================================================
-- 3. fn_check_question_storage_limit / trg_check_question_storage_limit
-- ============================================================

-- trigger function: prevent a user from exceeding their configured question quota.
-- fires BEFORE INSERT on questions so the exception cleanly aborts the statement
-- before any row is written. the count is taken before the new row exists, which
-- keeps the comparison accurate.
create or replace function fn_check_question_storage_limit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_current_count integer;
  v_limit         integer;
begin
  -- read the user's configured limit; default to 5 000 if no preferences row exists
  select coalesce(storage_limit_questions, 5000)
  into   v_limit
  from   user_preferences
  where  user_id = new.user_id;

  -- not found branch: query returned no rows; v_limit stays null — use the default
  if v_limit is null then
    v_limit := 5000;
  end if;

  -- count existing questions (the new row is not yet committed at this point)
  select count(*)
  into   v_current_count
  from   questions
  where  user_id = new.user_id;

  if v_current_count >= v_limit then
    raise exception
      'storage limit reached: you already have % question(s) and the configured limit is %',
      v_current_count, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_check_question_storage_limit
  before insert on questions
  for each row
  execute function fn_check_question_storage_limit();

-- ============================================================
-- 4. fn_update_questions_search_vector / trg_update_questions_search_vector
-- ============================================================

-- trigger function: keep the search_vector column in sync with question_text
-- and correct_answer on every insert or update.
-- uses a security-definer plpgsql function to ensure it runs with the
-- privileges required to write to the questions table regardless of the
-- calling role, and sets search_path explicitly to prevent injection.
-- fires BEFORE INSERT OR UPDATE so the new row already contains the
-- refreshed search_vector when it is written to disk.
create or replace function fn_update_questions_search_vector()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  -- build the tsvector from question text and the text representation of the
  -- correct_answer jsonb blob; both coalesces guard against null values.
  new.search_vector :=
    to_tsvector(
      'simple'::regconfig,
      coalesce(new.question_text, '') || ' ' || coalesce(new.correct_answer::text, '')
    );

  return new;
end;
$$;

create trigger trg_update_questions_search_vector
  before insert or update of question_text, correct_answer on questions
  for each row
  execute function fn_update_questions_search_vector();