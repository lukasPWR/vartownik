create or replace function public.complete_round_session_transition(
  p_user_id uuid,
  p_session_id uuid,
  p_round_id uuid
)
returns table (
  session_id uuid,
  round_id uuid,
  round_position smallint,
  round_status text,
  round_completed_at timestamp with time zone,
  session_status public.session_status_enum,
  session_completed_at timestamp with time zone
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_round public.rounds%rowtype;
  v_previous_round_status text;
  v_attempt_count integer;
  v_now timestamp with time zone := now();
begin
  select *
  into v_session
  from public.sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Session not found.' using errcode = 'P0001';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'Round can only be completed for an in-progress session.' using errcode = 'P0001';
  end if;

  select *
  into v_round
  from public.rounds
  where id = p_round_id
    and session_id = v_session.id
  for update;

  if not found then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;

  if v_round.status = 'completed' then
    raise exception 'Round has already been completed.' using errcode = 'P0001';
  end if;

  if v_round.position > 1 then
    select status
    into v_previous_round_status
    from public.rounds
    where session_id = v_session.id
      and position = v_round.position - 1;

    if not found then
      raise exception 'Session is missing a previous round.' using errcode = 'P0001';
    end if;

    if v_previous_round_status <> 'completed' then
      raise exception 'You must complete the previous round before completing this one.' using errcode = 'P0001';
    end if;
  end if;

  select count(*)
  into v_attempt_count
  from public.attempts
  where round_id = v_round.id;

  if v_attempt_count <> v_session.questions_per_round then
    raise exception 'Round cannot be completed until all attempts are recorded.' using errcode = 'P0001';
  end if;

  update public.rounds
  set
    status = 'completed',
    completed_at = v_now
  where id = v_round.id;

  if v_round.position = v_session.total_rounds then
    update public.sessions
    set
      status = 'completed',
      completed_at = v_now
    where id = v_session.id;

    v_session.status := 'completed';
    v_session.completed_at := v_now;
  end if;

  return query
  select
    v_session.id,
    v_round.id,
    v_round.position,
    'completed'::text,
    v_now,
    v_session.status,
    v_session.completed_at;
end;
$$;

grant execute on function public.complete_round_session_transition(uuid, uuid, uuid) to authenticated;
grant execute on function public.complete_round_session_transition(uuid, uuid, uuid) to service_role;
