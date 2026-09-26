-- Generation batch admission and terminal telemetry guardrails.

alter table public.generation_batches
  add column if not exists idempotency_key text,
  add column if not exists provider_attempt_count smallint not null default 0,
  add column if not exists input_tokens integer not null default 0,
  add column if not exists output_tokens integer not null default 0,
  add column if not exists failure_code text;

alter table public.generation_batches
  drop constraint if exists chk_generation_batches_provider_attempt_count,
  add constraint chk_generation_batches_provider_attempt_count
    check (provider_attempt_count >= 0),
  drop constraint if exists chk_generation_batches_input_tokens,
  add constraint chk_generation_batches_input_tokens
    check (input_tokens >= 0),
  drop constraint if exists chk_generation_batches_output_tokens,
  add constraint chk_generation_batches_output_tokens
    check (output_tokens >= 0);

create unique index if not exists ux_generation_batches_user_idempotency_key
  on public.generation_batches (user_id, idempotency_key)
  where idempotency_key is not null;

-- Keep the newest pending batch for each user. The UUID is the deterministic
-- tie-breaker for legacy rows created at the same timestamp.
with ranked_pending as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc, id desc
    ) as pending_rank
  from public.generation_batches
  where status = 'pending'
)
update public.generation_batches as batch
set
  status = 'failed',
  failure_code = 'superseded_legacy_pending',
  error_message = 'Superseded by a newer legacy pending generation batch.',
  finished_at = coalesce(batch.finished_at, now())
from ranked_pending
where batch.id = ranked_pending.id
  and ranked_pending.pending_rank > 1;

create unique index if not exists ux_generation_batches_one_pending_per_user
  on public.generation_batches (user_id)
  where status = 'pending';
