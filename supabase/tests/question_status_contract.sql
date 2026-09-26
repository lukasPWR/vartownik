-- Run with psql -v ON_ERROR_STOP=1 -f supabase/tests/question_status_contract.sql.
-- The migration is replayed inside this transaction; all fixtures and DDL roll back.
begin;

-- A previously applied migration must not prevent the legacy fixture.
drop trigger if exists trg_question_status_contract on public.questions;

insert into auth.users (id, aud, role, email)
values
  ('ad000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'status-contract-one@example.test'),
  ('ad000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'status-contract-two@example.test');

insert into public.questions
  (id, user_id, generated_type, status, question_text, correct_answer, difficulty_score, content_hash, updated_at)
values
  ('ad000000-0000-4000-8000-000000000011', 'ad000000-0000-4000-8000-000000000001', 'manual', 'needs_review', 'Legacy question text', '{"answer":"legacy"}', 2, 'contract-legacy', '2000-01-01'),
  ('ad000000-0000-4000-8000-000000000012', 'ad000000-0000-4000-8000-000000000001', 'manual', 'active', 'Owner question text', '{"answer":"owner"}', 2, 'contract-owner', '2000-01-01'),
  ('ad000000-0000-4000-8000-000000000013', 'ad000000-0000-4000-8000-000000000002', 'manual', 'active', 'Foreign question text', '{"answer":"foreign"}', 2, 'contract-foreign', '2000-01-01');

insert into public.sessions (id, user_id, timer_seconds)
values ('ad000000-0000-4000-8000-000000000021', 'ad000000-0000-4000-8000-000000000001', 20);
insert into public.rounds (id, session_id, position, status)
values ('ad000000-0000-4000-8000-000000000022', 'ad000000-0000-4000-8000-000000000021', 1, 'in_progress');
insert into public.attempts
  (user_id, session_id, round_id, question_id, position, scratchpad, time_taken_ms,
   question_text_snapshot, correct_answer_snapshot, difficulty_score_snapshot)
values
  ('ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000021',
   'ad000000-0000-4000-8000-000000000022', 'ad000000-0000-4000-8000-000000000012',
   1, '', 0, 'Owner question text', '{"answer":"owner"}', 2),
  ('ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000021',
   'ad000000-0000-4000-8000-000000000022', 'ad000000-0000-4000-8000-000000000013',
   2, '', 0, 'Foreign question text', '{"answer":"foreign"}', 2);

create temp table status_contract_counts as
select
  (select count(*) from public.questions) as questions_before,
  (select count(*) from public.attempts) as attempts_before;

\ir ../migrations/20260926170000_question_status_contract.sql

create or replace function pg_temp.expect_status_rejection(command text)
returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin
    execute command;
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'expected status rejection: %', command;
  end if;
end;
$$;

do $$
begin
  if (select status from public.questions where id = 'ad000000-0000-4000-8000-000000000011') <> 'flagged'
    or (select count(*) from public.questions) <> (select questions_before from status_contract_counts)
    or (select count(*) from public.attempts) <> (select attempts_before from status_contract_counts)
    or not exists (select 1 from pg_enum where enumlabel = 'needs_review'
                   and enumtypid = 'public.question_status_enum'::regtype) then
    raise exception 'migration did not preserve rows, enum, and flagged legacy question';
  end if;
end;
$$;

select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'needs_review'
  where id = 'ad000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_status_rejection($q$
  insert into public.questions
    (user_id, generated_type, status, question_text, correct_answer, difficulty_score, content_hash)
  values ('ad000000-0000-4000-8000-000000000001', 'manual', 'needs_review',
          'New alias question', '{}', 2, 'contract-new-alias')$q$);
select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'active'
  where id = 'ad000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'verified'
  where id = 'ad000000-0000-4000-8000-000000000012'$q$);
select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'verified', question_text = 'Resolved and edited'
  where id = 'ad000000-0000-4000-8000-000000000011'$q$);

-- Editing a flagged question leaves the report unresolved.
update public.questions set question_text = 'Edited legacy question'
where id = 'ad000000-0000-4000-8000-000000000011';
do $$
begin
  if not exists (
    select 1 from public.questions
    where id = 'ad000000-0000-4000-8000-000000000011'
      and status = 'flagged' and updated_at > '2000-01-01' and last_verified_at is null
  ) then
    raise exception 'flagged edit changed status or failed to update timestamp';
  end if;
end;
$$;

update public.questions set status = 'verified'
where id = 'ad000000-0000-4000-8000-000000000011';
create temp table verified_timestamp as
select last_verified_at, updated_at from public.questions
where id = 'ad000000-0000-4000-8000-000000000011';
do $$
begin
  if (select last_verified_at is null or updated_at is null from verified_timestamp) then
    raise exception 'resolution did not set timestamps';
  end if;
end;
$$;

update public.questions set status = 'flagged'
where id = 'ad000000-0000-4000-8000-000000000011';
select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'active'
  where id = 'ad000000-0000-4000-8000-000000000011'$q$);
do $$
begin
  if not exists (
    select 1 from public.questions q cross join verified_timestamp t
    where q.id = 'ad000000-0000-4000-8000-000000000011'
      and q.status = 'flagged' and q.last_verified_at = t.last_verified_at
      and q.updated_at >= t.updated_at
  ) then
    raise exception 'reflag lost verification history';
  end if;
end;
$$;

update public.questions set status = 'archived'
where id = 'ad000000-0000-4000-8000-000000000011';
select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'flagged'
  where id = 'ad000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_status_rejection($q$
  update public.questions set status = 'verified'
  where id = 'ad000000-0000-4000-8000-000000000011'$q$);
update public.questions set status = 'active'
where id = 'ad000000-0000-4000-8000-000000000011';
update public.questions set status = status
where id = 'ad000000-0000-4000-8000-000000000011';

-- The first flag changes only the attempt owner's active question.
update public.attempts set is_flagged_by_user = true
where round_id = 'ad000000-0000-4000-8000-000000000022' and position in (1, 2);
do $$
begin
  if (select status from public.questions where id = 'ad000000-0000-4000-8000-000000000012') <> 'flagged'
    or (select status from public.questions where id = 'ad000000-0000-4000-8000-000000000013') <> 'active' then
    raise exception 'flag trigger failed owner isolation';
  end if;
end;
$$;

create temp table first_flag_timestamp as
select updated_at from public.questions
where id = 'ad000000-0000-4000-8000-000000000012';
update public.attempts set is_flagged_by_user = false
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
update public.attempts set is_flagged_by_user = true
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
do $$
begin
  if not exists (
    select 1 from public.questions q cross join first_flag_timestamp t
    where q.id = 'ad000000-0000-4000-8000-000000000012'
      and q.status = 'flagged' and q.updated_at = t.updated_at
  ) then
    raise exception 'repeat flag changed an already flagged question';
  end if;
end;
$$;

update public.questions set status = 'verified'
where id = 'ad000000-0000-4000-8000-000000000012';
-- An already true flag, and unrelated updates to its attempt, do not flag again.
update public.attempts set scratchpad = 'unrelated update'
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
do $$
begin
  if (select status from public.questions where id = 'ad000000-0000-4000-8000-000000000012') <> 'verified' then
    raise exception 'unrelated attempt update reflagged question';
  end if;
end;
$$;

update public.attempts set is_flagged_by_user = false
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
update public.attempts set is_flagged_by_user = true
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
do $$
begin
  if (select status from public.questions where id = 'ad000000-0000-4000-8000-000000000012') <> 'flagged' then
    raise exception 'verified question did not reflag';
  end if;
end;
$$;

update public.questions set status = 'archived'
where id = 'ad000000-0000-4000-8000-000000000012';
update public.attempts set is_flagged_by_user = false
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
update public.attempts set is_flagged_by_user = true
where round_id = 'ad000000-0000-4000-8000-000000000022' and position = 1;
do $$
begin
  if (select status from public.questions where id = 'ad000000-0000-4000-8000-000000000012') <> 'archived' then
    raise exception 'attempt flag reactivated archived question';
  end if;
end;
$$;

rollback;
