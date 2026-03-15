-- =============================================================================
-- Migration: 20260315000007_create_category_stats_daily.sql
-- Purpose  : Create the category_stats_daily table for pre-aggregated
--            dashboard analytics (controlled denormalisation).
-- Affected : category_stats_daily
-- Notes    : One row per (date, user, category) combination. Counters are
--            updated by application code after each session completes, avoiding
--            expensive runtime aggregation over the partitioned attempts table.
--            All counters are non-negative integers enforced by a check constraint.
-- =============================================================================

-- ------------------------------------------------------------
-- table: category_stats_daily
-- ------------------------------------------------------------
create table category_stats_daily (
  stat_date          date        not null,
  user_id            uuid        not null references auth.users(id)  on delete cascade,
  category_id        uuid        not null references categories(id)  on delete cascade,
  -- total number of attempts attributed to this category on stat_date
  attempts_count     integer     not null default 0,
  -- number of attempts where verdict = 'knew'
  knew_count         integer     not null default 0,
  -- number of attempts where verdict = 'did_not_know'
  did_not_know_count integer     not null default 0,
  updated_at         timestamptz not null default now(),

-- one aggregated row per (date, user, category)
constraint pk_category_stats_daily
    primary key (stat_date, user_id, category_id),
  -- all counters must be non-negative (incremental upserts must not go below 0)
  constraint chk_category_stats_counts
    check (attempts_count >= 0 and knew_count >= 0 and did_not_know_count >= 0)
);

-- composite index: latest stats per user/category ordered by date descending
-- used by the performance dashboard to fetch the most recent data efficiently
create
index ix_category_stats_user_category_date on category_stats_daily (
    user_id,
    category_id,
    stat_date desc
);

-- ------------------------------------------------------------
-- rls: category_stats_daily
-- ------------------------------------------------------------
alter table category_stats_daily enable row level security;

alter table category_stats_daily force row level security;

-- authenticated: each user may read only their own stats rows
create policy "select_authenticated_own_rows" on category_stats_daily as permissive for
select to authenticated using (user_id = auth.uid ());

-- authenticated: each user may insert only rows keyed to themselves
create policy "insert_authenticated_own_rows" on category_stats_daily as permissive for
insert
    to authenticated
with
    check (user_id = auth.uid ());

-- authenticated: each user may update only their own stats rows (upsert pattern)
create policy "update_authenticated_own_rows" on category_stats_daily as permissive for
update to authenticated using (user_id = auth.uid ())
with
    check (user_id = auth.uid ());

-- authenticated: each user may delete only their own stats rows
create policy "delete_authenticated_own_rows" on category_stats_daily as permissive for
delete to authenticated using (user_id = auth.uid ());

-- anon: no access to any stats data
create policy "select_anon_none" on category_stats_daily as restrictive for
select to anon using (false);

create policy "insert_anon_none" on category_stats_daily as restrictive for
insert
    to anon
with
    check (false);

create policy "update_anon_none" on category_stats_daily as restrictive for
update to anon using (false)
with
    check (false);

create policy "delete_anon_none" on category_stats_daily as restrictive for
delete to anon using (false);