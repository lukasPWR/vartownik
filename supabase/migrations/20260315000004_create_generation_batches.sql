-- =============================================================================
-- Migration: 20260315000004_create_generation_batches.sql
-- Purpose  : Create the generation_batches table that tracks every AI
--            question-generation job (default 40 questions per batch).
-- Affected : generation_batches
-- Notes    : Each batch records the full request and response payloads for
--            audit and replay purposes. Status transitions: pending → success
--            or failed. A maximum of 2 retries is allowed per business rules.
--            Estimated cost (USD) is populated once the job finishes.
--            This table is referenced by sessions (generation_batch_id FK) to
--            link a session to the ai batch that supplied its questions.
-- =============================================================================

-- ------------------------------------------------------------
-- table: generation_batches
-- ------------------------------------------------------------
create table generation_batches (
    id uuid primary key default gen_random_uuid (),
    user_id uuid not null references auth.users (id) on delete cascade,
    -- ai provider name, e.g. 'openrouter'
    provider text not null,
    -- ai model identifier, e.g. 'gpt-4o', 'claude-3.5-sonnet'
    model text not null,
    -- version tag of the prompt template used (enables reproducibility)
    prompt_version text not null,
    schema_version smallint not null default 1,
    -- number of questions requested from the provider (default 40)
    requested_questions_count smallint not null default 40,
    -- number of questions actually present in the response
    returned_questions_count smallint not null default 0,
    -- retry attempt counter; capped at 2 by business rules
    retry_count smallint not null default 0,
    -- overall job state: pending | success | failed
    status text not null,
    -- estimated usd cost; null while pending, populated on completion
    estimated_cost_usd numeric(12, 6) null,
    error_message text null,
    -- full request sent to the ai provider (for audit and replay)
    request_payload jsonb not null,
    -- full response received from the ai provider; null while pending
    response_payload jsonb null,
    created_at timestamptz not null default now (),
    finished_at timestamptz null,
    constraint chk_generation_batches_status check (
        status in (
            'pending',
            'success',
            'failed'
        )
    ),
    constraint chk_generation_batches_requested_count check (requested_questions_count > 0),
    constraint chk_generation_batches_returned_count check (returned_questions_count >= 0),
    constraint chk_generation_batches_retry_count check (retry_count between 0 and 2),
    constraint chk_generation_batches_request_payload check (
        jsonb_typeof (request_payload) = 'object'
    ),
    -- response may be a json object or array; null while pending
    constraint chk_generation_batches_response_payload check (
        response_payload is null
        or jsonb_typeof (response_payload) in ('object', 'array')
    )
);

-- composite index: user's batch history ordered by recency (management view)
create
index ix_generation_batches_user_created on generation_batches (user_id, created_at desc);

-- index: operational monitoring of non-terminal ('pending') batches
create
index ix_generation_batches_status on generation_batches (status);

-- gin index: analytics queries on the structure of the request payload
create
index ix_generation_batches_request_payload_gin on generation_batches using gin (
    request_payload jsonb_path_ops
);

-- ------------------------------------------------------------
-- rls: generation_batches
-- ------------------------------------------------------------
alter table generation_batches enable row level security;

alter table generation_batches force row level security;

create policy "select_authenticated_own_rows" on generation_batches as permissive for
select to authenticated using (user_id = auth.uid ());

create policy "insert_authenticated_own_rows" on generation_batches as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

create policy "update_authenticated_own_rows" on generation_batches as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

create policy "delete_authenticated_own_rows" on generation_batches as permissive for
delete to authenticated using (user_id = auth.uid ());

create policy "select_anon_none" on generation_batches as restrictive for
select to anon using (false);

create policy "insert_anon_none" on generation_batches as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on generation_batches as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on generation_batches as restrictive for
delete to anon using (false);