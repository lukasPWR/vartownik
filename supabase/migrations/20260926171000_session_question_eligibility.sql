-- Validate and lock the complete batch mapping before the existing trigger
-- abandons an in-progress session. All locks live until the INSERT commits.
create or replace function public.fn_check_session_question_eligibility()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  payload jsonb;
  round_item jsonb;
  question_value jsonb;
  question_id uuid;
  question_ids uuid[] := '{}';
  locked_question record;
  batch_owner uuid;
  batch_status text;
begin
  if new.generation_batch_id is null then
    return new;
  end if;

  select user_id, status, response_payload into batch_owner, batch_status, payload
  from public.generation_batches where id = new.generation_batch_id;
  if not found or batch_owner <> new.user_id or batch_status <> 'success' then
    raise exception 'Session generation batch is unavailable'
      using errcode = 'P4220';
  end if;
  if jsonb_typeof(payload -> 'rounds') <> 'array'
    or jsonb_array_length(payload -> 'rounds') <> 4 then
    raise exception 'Generation batch rounds mapping is malformed'
      using errcode = 'P4220';
  end if;

  for round_item in select value from jsonb_array_elements(payload -> 'rounds') loop
    if jsonb_typeof(round_item -> 'position') <> 'number'
      or (round_item ->> 'position') not in ('1', '2', '3', '4')
      or jsonb_typeof(round_item -> 'question_ids') <> 'array'
      or jsonb_array_length(round_item -> 'question_ids') <> 10 then
      raise exception 'Generation batch rounds mapping is malformed'
        using errcode = 'P4220';
    end if;
    for question_value in select value from jsonb_array_elements(round_item -> 'question_ids') loop
      begin
        if jsonb_typeof(question_value) <> 'string' then
          raise exception 'non-string question id';
        end if;
        question_id := (question_value #>> '{}')::uuid;
      exception when others then
        raise exception 'Generation batch rounds mapping is malformed'
          using errcode = 'P4220';
      end;
      question_ids := array_append(question_ids, question_id);
    end loop;
  end loop;
  if (select count(distinct id) from unnest(question_ids) as ids(id)) <> 40
    or (select count(distinct value ->> 'position') from jsonb_array_elements(payload -> 'rounds')) <> 4 then
    raise exception 'Generation batch rounds mapping is malformed'
      using errcode = 'P4220';
  end if;

  -- Lock in a stable order to avoid deadlocks with another session start.
  for locked_question in
    select id, user_id, status from public.questions
    where id = any(question_ids)
    order by id for update
  loop
    if locked_question.user_id <> new.user_id then
      raise exception 'Generation batch rounds mapping references a foreign question'
        using errcode = 'P4220';
    end if;
    if locked_question.status not in ('active', 'verified') then
      raise exception 'Generation batch contains an unavailable question; generate a new batch'
        using errcode = 'P4090';
    end if;
  end loop;
  if (select count(*) from public.questions where id = any(question_ids)) <> 40 then
    raise exception 'Generation batch rounds mapping references a missing question'
      using errcode = 'P4220';
  end if;
  return new;
end;
$$;

drop trigger if exists check_session_question_eligibility on public.sessions;
create trigger check_session_question_eligibility
before insert on public.sessions
for each row execute function public.fn_check_session_question_eligibility();
