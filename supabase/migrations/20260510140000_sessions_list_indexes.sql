-- =============================================================================
-- Migration: sessions_list_indexes
-- Purpose:   Add a composite index on (user_id, status) to sessions to speed
--            up filtered list queries issued by GET /api/sessions?status=...
-- Affected tables: sessions
-- Notes:     The (user_id, started_at DESC) index for sorted pagination is
--            already present from migration 20260510130000.
-- =============================================================================

create
index if not exists sessions_user_status_idx on sessions (user_id, status);