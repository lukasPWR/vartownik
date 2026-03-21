-- =============================================================================
-- Migration: questions_list_indexes
-- Purpose:   Add performance indexes to support GET /api/questions endpoint.
--            Covers all filter, sort, and full-text search query patterns used
--            by the listQuestions service function.
-- Affected tables: questions, question_categories, question_tags
-- Notes:     All indexes use IF NOT EXISTS so the migration is re-runnable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- questions table indexes
-- ---------------------------------------------------------------------------

-- Default sort: ORDER BY created_at DESC filtered by user_id (most common path)
create
index if not exists idx_questions_user_id_created_at on questions (user_id, created_at desc);

-- Sort by difficulty (difficulty_asc / difficulty_desc) filtered by user_id
create
index if not exists idx_questions_user_id_difficulty_score on questions (user_id, difficulty_score);

-- Filter by status column
create
index if not exists idx_questions_user_id_status on questions (user_id, status);

-- Filter by generated_type column
create
index if not exists idx_questions_user_id_generated_type on questions (user_id, generated_type);

-- Full-text search via tsvector column (websearch_to_tsquery / to_tsquery)
-- The search_vector column must be kept up-to-date by a trigger or generated column.
create
index if not exists idx_questions_search_vector on questions using gin (search_vector);

-- ---------------------------------------------------------------------------
-- question_categories join table index
-- ---------------------------------------------------------------------------

-- Supports !inner join filter on category_id provided to GET /api/questions
create
index if not exists idx_question_categories_category_id_question_id on question_categories (category_id, question_id);

-- ---------------------------------------------------------------------------
-- question_tags join table index
-- ---------------------------------------------------------------------------

-- Supports !inner join filter on tag_id provided to GET /api/questions
create
index if not exists idx_question_tags_tag_id_question_id on question_tags (tag_id, question_id);