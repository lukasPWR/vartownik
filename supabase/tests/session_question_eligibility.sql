-- Transactional regression test: psql -v ON_ERROR_STOP=1 -f this-file.sql
begin;
\ir ../migrations/20260926171000_session_question_eligibility.sql

insert into auth.users (id, aud, role, email)
values ('be000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'eligibility-one@example.test'),
       ('be000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'eligibility-two@example.test');

insert into public.questions
  (id, user_id, generated_type, status, question_text, correct_answer, difficulty_score, content_hash)
select ('be000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'be000000-0000-4000-8000-000000000001', 'ai', 'active', 'Eligible question ' || n,
  '{"primary":"answer","synonyms":[]}'::jsonb, 2, 'eligibility-' || n
from generate_series(101, 140) n;

insert into public.generation_batches
  (id, user_id, provider, model, prompt_version, status, request_payload, response_payload)
select 'be000000-0000-4000-8000-000000000050', 'be000000-0000-4000-8000-000000000001',
  'openai', 'test', 'v1', 'success', '{}'::jsonb,
  jsonb_build_object('rounds', (
    select jsonb_agg(jsonb_build_object('position', r, 'question_ids', (
      select jsonb_agg(('be000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid order by n)
      from generate_series(101 + (r-1)*10, 110 + (r-1)*10) n
    )) order by r) from generate_series(1, 4) r
  ));

create temp table original_batch_payload as
select response_payload from public.generation_batches
where id = 'be000000-0000-4000-8000-000000000050';

create or replace function pg_temp.expect_session_rejection(expected_code text)
returns void language plpgsql as $$
declare actual_code text;
begin
  begin
    insert into public.sessions (user_id, generation_batch_id, timer_seconds)
    values ('be000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000050', 20);
  exception when others then
    get stacked diagnostics actual_code = returned_sqlstate;
  end;
  if actual_code is distinct from expected_code then
    raise exception 'expected SQLSTATE %, got %', expected_code, actual_code;
  end if;
end;
$$;

insert into public.sessions (user_id, generation_batch_id, timer_seconds)
values ('be000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000050', 20);

update public.questions set status = 'flagged' where id = 'be000000-0000-4000-8000-000000000101';
select pg_temp.expect_session_rejection('P4090');
update public.questions set status = 'verified' where id = 'be000000-0000-4000-8000-000000000101';
insert into public.sessions (user_id, generation_batch_id, timer_seconds)
values ('be000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000050', 20);
update public.questions set status = 'archived' where id = 'be000000-0000-4000-8000-000000000102';
select pg_temp.expect_session_rejection('P4090');
update public.questions set status = 'active' where id = 'be000000-0000-4000-8000-000000000102';

update public.generation_batches set response_payload = '{"rounds":[]}'
where id = 'be000000-0000-4000-8000-000000000050';
select pg_temp.expect_session_rejection('P4220');

update public.generation_batches set response_payload = (select response_payload from original_batch_payload)
where id = 'be000000-0000-4000-8000-000000000050';
delete from public.questions where id = 'be000000-0000-4000-8000-000000000140';
select pg_temp.expect_session_rejection('P4220');

do $$
begin
  if (select count(*) from public.sessions where generation_batch_id = 'be000000-0000-4000-8000-000000000050') <> 2 then
    raise exception 'rejected session insert left a row behind';
  end if;
  if (select count(*) from public.sessions where generation_batch_id = 'be000000-0000-4000-8000-000000000050'
      and status = 'in_progress') <> 1 then
    raise exception 'rejected insert abandoned the existing in-progress session';
  end if;
end;
$$;
rollback;
