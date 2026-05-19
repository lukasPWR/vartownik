-- =============================================================================
-- Migration: attempts_rls
-- Purpose:   Enable Row-Level Security on the `attempts` table and add a
--            SELECT policy so that authenticated users can only read attempts
--            belonging to rounds of their own sessions.
--            This is required for the nested Supabase query
--            rounds(attempts(verdict)) used in GET /api/sessions to return
--            data instead of empty arrays.
-- Affected tables: attempts
-- Notes:     All DDL uses IF NOT EXISTS guards for safe re-runs in CI.
-- =============================================================================

alter table attempts enable row level security;

-- SELECT: users may only read attempts that belong to rounds of their own sessions
create policy "attempts_select_own" on attempts for
select to authenticated using (
        exists (
            select 1
            from rounds r
                inner join sessions s on s.id = r.session_id
            where
                r.id = attempts.round_id
                and s.user_id = auth.uid ()
        )
    );