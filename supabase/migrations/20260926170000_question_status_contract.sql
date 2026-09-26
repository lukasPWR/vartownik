-- Keep the legacy enum value for schema compatibility, but remove its rows.
update public.questions
set status = 'flagged'
where status = 'needs_review';

create or replace function public.fn_enforce_question_status_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'needs_review' then
    raise exception 'needs_review is no longer a writable question status'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status in ('active', 'verified') and new.status in ('flagged', 'archived'))
      or (old.status = 'flagged' and new.status in ('verified', 'archived'))
      or (old.status = 'archived' and new.status = 'active')
    ) then
      raise exception 'invalid question status transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    -- Resolving a report is an explicit status action, separate from editing.
    if old.status = 'flagged' and new.status = 'verified' and (
      new.question_text is distinct from old.question_text
      or new.correct_answer is distinct from old.correct_answer
      or new.difficulty_score is distinct from old.difficulty_score
      or new.image_path is distinct from old.image_path
      or new.content_hash is distinct from old.content_hash
      or new.source_model is distinct from old.source_model
      or new.generation_metadata is distinct from old.generation_metadata
      or new.schema_version is distinct from old.schema_version
      or new.generated_type is distinct from old.generated_type
    ) then
      raise exception 'resolve a flagged question separately from content edits'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  if old.status = 'flagged' and new.status = 'verified' then
    new.last_verified_at := clock_timestamp();
  else
    new.last_verified_at := old.last_verified_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_question_status_contract on public.questions;
create trigger trg_question_status_contract
before insert or update on public.questions
for each row execute function public.fn_enforce_question_status_contract();

create or replace function public.fn_flag_question_for_review()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_flagged_by_user = false and new.is_flagged_by_user = true then
    update public.questions
    set status = 'flagged'
    where id = new.question_id
      and user_id = new.user_id
      and status in ('active', 'verified');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_flag_question_for_review on public.attempts;
create trigger trg_flag_question_for_review
after update of is_flagged_by_user on public.attempts
for each row
when (old.is_flagged_by_user = false and new.is_flagged_by_user = true)
execute function public.fn_flag_question_for_review();
