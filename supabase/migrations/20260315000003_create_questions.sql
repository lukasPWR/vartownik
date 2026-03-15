-- =============================================================================
-- Migration: 20260315000003_create_questions.sql
-- Purpose  : Create the questions table plus the three tables that extend it:
--              question_categories – N:M link to categories
--              question_tags       – N:M link to tags (optional module)
--              question_edits      – immutable audit log of edits
-- Affected : questions, question_categories, question_tags, question_edits
-- Notes    : questions has a generated stored tsvector column (search_vector)
--            for full-text search. The content_hash column prevents duplicate
--            questions per user and is checked by a trigger (added in
--            20260315000008_create_triggers.sql).
--            correct_answer JSONB format:
--              { "primary": string,
--                "synonyms": string[],
--                "weighted_synonyms": [{ "value": string, "weight": numeric }] }
--            question_edits rows are immutable audit entries; the update RLS
--            policy for authenticated users intentionally blocks all updates.
-- =============================================================================

-- ------------------------------------------------------------
-- table: questions
-- Core store for both manually authored and AI-generated questions.
-- ------------------------------------------------------------
create table questions (
    id uuid primary key default gen_random_uuid (),
    user_id uuid not null references auth.users (id) on delete cascade,
    generated_type generated_type_enum not null,
    status question_status_enum not null default 'active',
    question_text text not null,
    -- answer payload; must always be a json object (see format in file header)
    correct_answer jsonb not null,
    -- 1 (easy) to 5 (very hard)
    difficulty_score smallint not null,
    -- storage path in the 'quiz-images' supabase bucket:
    -- convention: quiz-images/{user_id}/{question_id}/{filename}
    image_path text null,
    -- sha-256 content fingerprint; prevents duplicate questions per user
    content_hash text not null,
    -- ai model used to generate this question; null for manual questions
    source_model text null,
    -- raw ai provider metadata (token counts, costs, etc.) for auditing
    generation_metadata jsonb null,
    schema_version smallint not null default 1,
    last_verified_at timestamptz null,
    created_at timestamptz not null default now (),
    updated_at timestamptz not null default now (),
    -- full-text search vector; maintained by trg_update_questions_search_vector
    -- (defined in 20260315000008_create_triggers.sql) on every insert/update.
    -- not a generated stored column to avoid jsonb immutability constraints.
    search_vector tsvector null,
    constraint chk_questions_text_length check (
        char_length (question_text) >= 10
    ),
    constraint chk_questions_difficulty check (
        difficulty_score between 1 and 5
    ),
    constraint chk_questions_correct_answer_type check (
        jsonb_typeof (correct_answer) = 'object'
    ),
    constraint chk_questions_generation_metadata_type check (
        generation_metadata is null
        or jsonb_typeof (generation_metadata) = 'object'
    ),
    -- enforces deduplication per user (content hash is sha-256 of question+answer)
    constraint uq_questions_user_content_hash unique (user_id, content_hash)
);

-- gin index enables fast full-text search via the generated search_vector column
create
index ix_questions_search_vector on questions using gin (search_vector);

-- gin jsonb_path_ops index for efficient jsonb path queries on correct_answer
create
index ix_questions_correct_answer_gin on questions using gin (correct_answer jsonb_path_ops);

-- composite index: filter by status ordered by recency (dashboard + management views)
create
index ix_questions_status_created on questions (
    user_id,
    status,
    created_at desc
);

-- ------------------------------------------------------------
-- rls: questions
-- ------------------------------------------------------------
alter table questions enable row level security;

alter table questions force row level security;

create policy "select_authenticated_own_rows" on questions as permissive for
select to authenticated using (user_id = auth.uid ());

create policy "insert_authenticated_own_rows" on questions as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

create policy "update_authenticated_own_rows" on questions as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

create policy "delete_authenticated_own_rows" on questions as permissive for
delete to authenticated using (user_id = auth.uid ());

create policy "select_anon_none" on questions as restrictive for
select to anon using (false);

create policy "insert_anon_none" on questions as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on questions as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on questions as restrictive for
delete to anon using (false);

-- ------------------------------------------------------------
-- table: question_categories
-- N:M join table. No user_id column; ownership is derived from
-- the referenced question's user_id via rls subquery checks.
-- ------------------------------------------------------------
create table question_categories (
    question_id uuid not null references questions (id) on delete cascade,
    category_id uuid not null references categories (id) on delete cascade,
    created_at timestamptz not null default now (),
    constraint pk_question_categories primary key (question_id, category_id)
);

alter table question_categories enable row level security;

alter table question_categories force row level security;

-- ownership: caller must own the parent question
create policy "select_authenticated_own_rows" on question_categories as permissive for
select to authenticated using (
        exists (
            select 1
            from questions q
            where
                q.id = question_id
                and q.user_id = auth.uid ()
        )
    );

create policy "insert_authenticated_own_rows" on question_categories as permissive for
insert
    to authenticated
with
    check (
        exists (
            select 1
            from questions q
            where
                q.id = question_id
                and q.user_id = auth.uid ()
        )
    );

create policy "update_authenticated_own_rows" on question_categories as permissive for
update to authenticated using (
    exists (
        select 1
        from questions q
        where
            q.id = question_id
            and q.user_id = auth.uid ()
    )
)
with
    check (
        exists (
            select 1
            from questions q
            where
                q.id = question_id
                and q.user_id = auth.uid ()
        )
    );

create policy "delete_authenticated_own_rows" on question_categories as permissive for
delete to authenticated using (
    exists (
        select 1
        from questions q
        where
            q.id = question_id
            and q.user_id = auth.uid ()
    )
);

create policy "select_anon_none" on question_categories as restrictive for
select to anon using (false);

create policy "insert_anon_none" on question_categories as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on question_categories as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on question_categories as restrictive for
delete to anon using (false);

-- ------------------------------------------------------------
-- table: question_tags
-- N:M join table (optional tagging module). Ownership derived
-- from the parent question's user_id, identical to question_categories.
-- ------------------------------------------------------------
create table question_tags (
    question_id uuid not null references questions (id) on delete cascade,
    tag_id uuid not null references tags (id) on delete cascade,
    created_at timestamptz not null default now (),
    constraint pk_question_tags primary key (question_id, tag_id)
);

alter table question_tags enable row level security;

alter table question_tags force row level security;

create policy "select_authenticated_own_rows" on question_tags as permissive for
select to authenticated using (
        exists (
            select 1
            from questions q
            where
                q.id = question_id
                and q.user_id = auth.uid ()
        )
    );

create policy "insert_authenticated_own_rows" on question_tags as permissive for
insert
    to authenticated
with
    check (
        exists (
            select 1
            from questions q
            where
                q.id = question_id
                and q.user_id = auth.uid ()
        )
    );

create policy "update_authenticated_own_rows" on question_tags as permissive for
update to authenticated using (
    exists (
        select 1
        from questions q
        where
            q.id = question_id
            and q.user_id = auth.uid ()
    )
)
with
    check (
        exists (
            select 1
            from questions q
            where
                q.id = question_id
                and q.user_id = auth.uid ()
        )
    );

create policy "delete_authenticated_own_rows" on question_tags as permissive for
delete to authenticated using (
    exists (
        select 1
        from questions q
        where
            q.id = question_id
            and q.user_id = auth.uid ()
    )
);

create policy "select_anon_none" on question_tags as restrictive for
select to anon using (false);

create policy "insert_anon_none" on question_tags as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on question_tags as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on question_tags as restrictive for
delete to anon using (false);

-- ------------------------------------------------------------
-- table: question_edits
-- Immutable audit log of every manual correction, flagging event,
-- or post-hallucination AI fix. Once inserted, rows must never
-- be updated (enforced by the restrictive update rls policy below).
-- old_payload / new_payload capture the full question state as
-- jsonb snapshots before and after the change.
-- ------------------------------------------------------------
create table question_edits (
    id uuid primary key default gen_random_uuid (),
    question_id uuid not null references questions (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    change_reason text not null,
    -- full snapshot of the question record before the edit
    old_payload jsonb not null,
    -- full snapshot of the question record after the edit
    new_payload jsonb not null,
    created_at timestamptz not null default now (),
    constraint chk_question_edits_old_payload check (
        jsonb_typeof (old_payload) = 'object'
    ),
    constraint chk_question_edits_new_payload check (
        jsonb_typeof (new_payload) = 'object'
    )
);

-- index: fetch the chronological edit history of a specific question efficiently
create
index ix_question_edits_question_created on question_edits (question_id, created_at desc);

alter table question_edits enable row level security;

alter table question_edits force row level security;

-- authenticated: users may read their own edit records
create policy "select_authenticated_own_rows" on question_edits as permissive for
select to authenticated using (user_id = auth.uid ());

-- authenticated: users may insert their own edit records
create policy "insert_authenticated_own_rows" on question_edits as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- authenticated: updates are intentionally BLOCKED — audit log must be immutable
create policy "update_authenticated_own_rows" on question_edits as permissive for
update to authenticated using (false)
with
    check (false);

-- authenticated: users may delete their own edit records (e.g. account wipe)
create policy "delete_authenticated_own_rows" on question_edits as permissive for
delete to authenticated using (user_id = auth.uid ());

create policy "select_anon_none" on question_edits as restrictive for
select to anon using (false);

create policy "insert_anon_none" on question_edits as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on question_edits as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on question_edits as restrictive for
delete to anon using (false);