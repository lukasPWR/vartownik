


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."attempt_verdict_enum" AS ENUM (
    'knew',
    'did_not_know'
);


ALTER TYPE "public"."attempt_verdict_enum" OWNER TO "postgres";


CREATE TYPE "public"."generated_type_enum" AS ENUM (
    'manual',
    'ai'
);


ALTER TYPE "public"."generated_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."question_status_enum" AS ENUM (
    'active',
    'flagged',
    'needs_review',
    'verified',
    'archived'
);


ALTER TYPE "public"."question_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."session_status_enum" AS ENUM (
    'in_progress',
    'completed',
    'abandoned'
);


ALTER TYPE "public"."session_status_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_abandon_stale_sessions"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- mark all prior in_progress sessions for this user as abandoned,
  -- excluding the session row that just triggered this call
  update sessions
  set
    status       = 'abandoned',
    abandoned_at = now()
  where user_id  = new.user_id
    and status   = 'in_progress'
    and id      <> new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_abandon_stale_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_question_storage_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_current_count integer;
  v_limit         integer;
begin
  -- read the user's configured limit; default to 5 000 if no preferences row exists
  select coalesce(storage_limit_questions, 5000)
  into   v_limit
  from   user_preferences
  where  user_id = new.user_id;

  -- not found branch: query returned no rows; v_limit stays null — use the default
  if v_limit is null then
    v_limit := 5000;
  end if;

  -- count existing questions (the new row is not yet committed at this point)
  select count(*)
  into   v_current_count
  from   questions
  where  user_id = new.user_id;

  if v_current_count >= v_limit then
    raise exception
      'storage limit reached: you already have % question(s) and the configured limit is %',
      v_current_count, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_check_question_storage_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_flag_question_for_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- only act when the flag is explicitly set on the incoming row
  if new.is_flagged_by_user = true then
    update questions
    set status = 'needs_review'
    where id = new.question_id
      -- do not overwrite a more terminal state (needs_review or archived)
      and status not in ('needs_review', 'archived');
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_flag_question_for_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_questions_search_vector"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- build the tsvector from question text and the text representation of the
  -- correct_answer jsonb blob; both coalesces guard against null values.
  new.search_vector :=
    to_tsvector(
      'simple'::regconfig,
      coalesce(new.question_text, '') || ' ' || coalesce(new.correct_answer::text, '')
    );

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_update_questions_search_vector"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attempts" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "round_id" "uuid" NOT NULL,
    "question_id" "uuid" NOT NULL,
    "position" smallint NOT NULL,
    "scratchpad" "text",
    "time_taken_ms" integer NOT NULL,
    "timer_expired" boolean DEFAULT false NOT NULL,
    "verdict" "public"."attempt_verdict_enum",
    "is_flagged_by_user" boolean DEFAULT false NOT NULL,
    "flag_reason" "text",
    "question_text_snapshot" "text" NOT NULL,
    "correct_answer_snapshot" "jsonb" NOT NULL,
    "difficulty_score_snapshot" smallint NOT NULL,
    CONSTRAINT "chk_attempts_correct_answer_snapshot" CHECK (("jsonb_typeof"("correct_answer_snapshot") = 'object'::"text")),
    CONSTRAINT "chk_attempts_difficulty_snapshot" CHECK ((("difficulty_score_snapshot" >= 1) AND ("difficulty_score_snapshot" <= 5))),
    CONSTRAINT "chk_attempts_position" CHECK (("position" > 0)),
    CONSTRAINT "chk_attempts_time_taken" CHECK (("time_taken_ms" >= 0)),
    CONSTRAINT "chk_attempts_verdict_or_timer_or_scratchpad" CHECK ((("verdict" IS NOT NULL) OR ("timer_expired" = true) OR ("scratchpad" IS NOT NULL)))
);

ALTER TABLE ONLY "public"."attempts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."attempts" OWNER TO "postgres";


ALTER TABLE "public"."attempts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_categories_name_length" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 120)))
);

ALTER TABLE ONLY "public"."categories" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_stats_daily" (
    "stat_date" "date" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "attempts_count" integer DEFAULT 0 NOT NULL,
    "knew_count" integer DEFAULT 0 NOT NULL,
    "did_not_know_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_category_stats_counts" CHECK ((("attempts_count" >= 0) AND ("knew_count" >= 0) AND ("did_not_know_count" >= 0)))
);

ALTER TABLE ONLY "public"."category_stats_daily" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_stats_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."generation_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "schema_version" smallint DEFAULT 1 NOT NULL,
    "requested_questions_count" smallint DEFAULT 40 NOT NULL,
    "returned_questions_count" smallint DEFAULT 0 NOT NULL,
    "retry_count" smallint DEFAULT 0 NOT NULL,
    "status" "text" NOT NULL,
    "estimated_cost_usd" numeric(12,6),
    "error_message" "text",
    "request_payload" "jsonb" NOT NULL,
    "response_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "chk_generation_batches_request_payload" CHECK (("jsonb_typeof"("request_payload") = 'object'::"text")),
    CONSTRAINT "chk_generation_batches_requested_count" CHECK (("requested_questions_count" > 0)),
    CONSTRAINT "chk_generation_batches_response_payload" CHECK ((("response_payload" IS NULL) OR ("jsonb_typeof"("response_payload") = ANY (ARRAY['object'::"text", 'array'::"text"])))),
    CONSTRAINT "chk_generation_batches_retry_count" CHECK ((("retry_count" >= 0) AND ("retry_count" <= 2))),
    CONSTRAINT "chk_generation_batches_returned_count" CHECK (("returned_questions_count" >= 0)),
    CONSTRAINT "chk_generation_batches_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."generation_batches" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."generation_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."question_categories" (
    "question_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."question_categories" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."question_edits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "change_reason" "text" NOT NULL,
    "old_payload" "jsonb" NOT NULL,
    "new_payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_question_edits_new_payload" CHECK (("jsonb_typeof"("new_payload") = 'object'::"text")),
    CONSTRAINT "chk_question_edits_old_payload" CHECK (("jsonb_typeof"("old_payload") = 'object'::"text"))
);

ALTER TABLE ONLY "public"."question_edits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_edits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."question_tags" (
    "question_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."question_tags" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "generated_type" "public"."generated_type_enum" NOT NULL,
    "status" "public"."question_status_enum" DEFAULT 'active'::"public"."question_status_enum" NOT NULL,
    "question_text" "text" NOT NULL,
    "correct_answer" "jsonb" NOT NULL,
    "difficulty_score" smallint NOT NULL,
    "image_path" "text",
    "content_hash" "text" NOT NULL,
    "source_model" "text",
    "generation_metadata" "jsonb",
    "schema_version" smallint DEFAULT 1 NOT NULL,
    "last_verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector",
    CONSTRAINT "chk_questions_correct_answer_type" CHECK (("jsonb_typeof"("correct_answer") = 'object'::"text")),
    CONSTRAINT "chk_questions_difficulty" CHECK ((("difficulty_score" >= 1) AND ("difficulty_score" <= 5))),
    CONSTRAINT "chk_questions_generation_metadata_type" CHECK ((("generation_metadata" IS NULL) OR ("jsonb_typeof"("generation_metadata") = 'object'::"text"))),
    CONSTRAINT "chk_questions_text_length" CHECK (("char_length"("question_text") >= 10))
);

ALTER TABLE ONLY "public"."questions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rounds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "position" smallint NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_rounds_position" CHECK (("position" > 0)),
    CONSTRAINT "chk_rounds_status" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text"])))
);

ALTER TABLE ONLY "public"."rounds" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."rounds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "generation_batch_id" "uuid",
    "status" "public"."session_status_enum" DEFAULT 'in_progress'::"public"."session_status_enum" NOT NULL,
    "timer_seconds" smallint NOT NULL,
    "total_rounds" smallint DEFAULT 4 NOT NULL,
    "questions_per_round" smallint DEFAULT 10 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "abandoned_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_sessions_abandoned_at" CHECK (((("status" = 'abandoned'::"public"."session_status_enum") AND ("abandoned_at" IS NOT NULL)) OR ("status" <> 'abandoned'::"public"."session_status_enum"))),
    CONSTRAINT "chk_sessions_completed_at" CHECK (((("status" = 'completed'::"public"."session_status_enum") AND ("completed_at" IS NOT NULL)) OR ("status" <> 'completed'::"public"."session_status_enum"))),
    CONSTRAINT "chk_sessions_questions_per_round" CHECK (("questions_per_round" > 0)),
    CONSTRAINT "chk_sessions_timer" CHECK ((("timer_seconds" >= 15) AND ("timer_seconds" <= 30))),
    CONSTRAINT "chk_sessions_total_rounds" CHECK (("total_rounds" > 0))
);

ALTER TABLE ONLY "public"."sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."tags" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "category_weights" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_timer_seconds" smallint DEFAULT 20 NOT NULL,
    "storage_limit_questions" integer DEFAULT 5000 NOT NULL,
    "storage_limit_images_bytes" bigint DEFAULT 1073741824 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_user_prefs_category_weights_type" CHECK (("jsonb_typeof"("category_weights") = 'object'::"text")),
    CONSTRAINT "chk_user_prefs_storage_images" CHECK (("storage_limit_images_bytes" > 0)),
    CONSTRAINT "chk_user_prefs_storage_questions" CHECK (("storage_limit_questions" > 0)),
    CONSTRAINT "chk_user_prefs_timer" CHECK ((("default_timer_seconds" >= 15) AND ("default_timer_seconds" <= 30)))
);

ALTER TABLE ONLY "public"."user_preferences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generation_batches"
    ADD CONSTRAINT "generation_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."category_stats_daily"
    ADD CONSTRAINT "pk_category_stats_daily" PRIMARY KEY ("stat_date", "user_id", "category_id");



ALTER TABLE ONLY "public"."question_categories"
    ADD CONSTRAINT "pk_question_categories" PRIMARY KEY ("question_id", "category_id");



ALTER TABLE ONLY "public"."question_tags"
    ADD CONSTRAINT "pk_question_tags" PRIMARY KEY ("question_id", "tag_id");



ALTER TABLE ONLY "public"."question_edits"
    ADD CONSTRAINT "question_edits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rounds"
    ADD CONSTRAINT "rounds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "uq_attempts_round_position" UNIQUE ("round_id", "position");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "uq_categories_user_slug" UNIQUE ("user_id", "slug");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "uq_questions_user_content_hash" UNIQUE ("user_id", "content_hash");



ALTER TABLE ONLY "public"."rounds"
    ADD CONSTRAINT "uq_rounds_session_position" UNIQUE ("session_id", "position");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "ix_attempts_question" ON "public"."attempts" USING "btree" ("question_id");



CREATE INDEX "ix_attempts_user_created_at" ON "public"."attempts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ix_attempts_user_verdict_created" ON "public"."attempts" USING "btree" ("user_id", "verdict", "created_at" DESC);



CREATE INDEX "ix_category_stats_user_category_date" ON "public"."category_stats_daily" USING "btree" ("user_id", "category_id", "stat_date" DESC);



CREATE INDEX "ix_generation_batches_request_payload_gin" ON "public"."generation_batches" USING "gin" ("request_payload" "jsonb_path_ops");



CREATE INDEX "ix_generation_batches_status" ON "public"."generation_batches" USING "btree" ("status");



CREATE INDEX "ix_generation_batches_user_created" ON "public"."generation_batches" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ix_question_edits_question_created" ON "public"."question_edits" USING "btree" ("question_id", "created_at" DESC);



CREATE INDEX "ix_questions_correct_answer_gin" ON "public"."questions" USING "gin" ("correct_answer" "jsonb_path_ops");



CREATE INDEX "ix_questions_search_vector" ON "public"."questions" USING "gin" ("search_vector");



CREATE INDEX "ix_questions_status_created" ON "public"."questions" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE INDEX "ix_rounds_session_position" ON "public"."rounds" USING "btree" ("session_id", "position");



CREATE INDEX "ix_sessions_user_status_started" ON "public"."sessions" USING "btree" ("user_id", "status", "started_at" DESC);



CREATE UNIQUE INDEX "ux_categories_user_name_ci" ON "public"."categories" USING "btree" ("user_id", "lower"("name"));



CREATE UNIQUE INDEX "ux_tags_user_name_ci" ON "public"."tags" USING "btree" ("user_id", "lower"("name"));



CREATE OR REPLACE TRIGGER "trg_abandon_stale_sessions" AFTER INSERT ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_abandon_stale_sessions"();



CREATE OR REPLACE TRIGGER "trg_check_question_storage_limit" BEFORE INSERT ON "public"."questions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_check_question_storage_limit"();



CREATE OR REPLACE TRIGGER "trg_flag_question_for_review" AFTER INSERT OR UPDATE OF "is_flagged_by_user" ON "public"."attempts" FOR EACH ROW EXECUTE FUNCTION "public"."fn_flag_question_for_review"();



CREATE OR REPLACE TRIGGER "trg_update_questions_search_vector" BEFORE INSERT OR UPDATE OF "question_text", "correct_answer" ON "public"."questions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_questions_search_vector"();



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_stats_daily"
    ADD CONSTRAINT "category_stats_daily_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_stats_daily"
    ADD CONSTRAINT "category_stats_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generation_batches"
    ADD CONSTRAINT "generation_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_categories"
    ADD CONSTRAINT "question_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_categories"
    ADD CONSTRAINT "question_categories_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_edits"
    ADD CONSTRAINT "question_edits_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_edits"
    ADD CONSTRAINT "question_edits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_tags"
    ADD CONSTRAINT "question_tags_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_tags"
    ADD CONSTRAINT "question_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rounds"
    ADD CONSTRAINT "rounds_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_generation_batch_id_fkey" FOREIGN KEY ("generation_batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_stats_daily" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delete_anon_none" ON "public"."attempts" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."categories" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."category_stats_daily" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."generation_batches" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."question_categories" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."question_edits" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."question_tags" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."questions" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."rounds" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."sessions" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."tags" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_anon_none" ON "public"."user_preferences" AS RESTRICTIVE FOR DELETE TO "anon" USING (false);



CREATE POLICY "delete_authenticated_own_rows" ON "public"."attempts" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."categories" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."category_stats_daily" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."generation_batches" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."question_categories" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_categories"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."question_edits" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."question_tags" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_tags"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."questions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."rounds" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "rounds"."session_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."sessions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."tags" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_authenticated_own_rows" ON "public"."user_preferences" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."generation_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_anon_none" ON "public"."attempts" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."categories" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."category_stats_daily" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."generation_batches" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."question_categories" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."question_edits" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."question_tags" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."questions" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."rounds" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."sessions" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."tags" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_anon_none" ON "public"."user_preferences" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (false);



CREATE POLICY "insert_authenticated_own_rows" ON "public"."attempts" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."categories" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."category_stats_daily" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."generation_batches" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."question_categories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_categories"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."question_edits" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."question_tags" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_tags"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."questions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."rounds" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "rounds"."session_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."sessions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."tags" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_authenticated_own_rows" ON "public"."user_preferences" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."question_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_edits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rounds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_anon_none" ON "public"."attempts" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."categories" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."category_stats_daily" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."generation_batches" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."question_categories" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."question_edits" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."question_tags" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."questions" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."rounds" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."sessions" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."tags" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_anon_none" ON "public"."user_preferences" AS RESTRICTIVE FOR SELECT TO "anon" USING (false);



CREATE POLICY "select_authenticated_own_rows" ON "public"."attempts" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."categories" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."category_stats_daily" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."generation_batches" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."question_categories" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_categories"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "select_authenticated_own_rows" ON "public"."question_edits" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."question_tags" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_tags"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "select_authenticated_own_rows" ON "public"."questions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."rounds" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "rounds"."session_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "select_authenticated_own_rows" ON "public"."sessions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."tags" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_authenticated_own_rows" ON "public"."user_preferences" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_anon_none" ON "public"."attempts" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."categories" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."category_stats_daily" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."generation_batches" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."question_categories" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."question_edits" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."question_tags" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."questions" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."rounds" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."sessions" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."tags" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_anon_none" ON "public"."user_preferences" AS RESTRICTIVE FOR UPDATE TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "update_authenticated_own_rows" ON "public"."attempts" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."categories" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."category_stats_daily" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."generation_batches" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."question_categories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_categories"."question_id") AND ("q"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_categories"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "update_authenticated_own_rows" ON "public"."question_edits" FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "update_authenticated_own_rows" ON "public"."question_tags" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_tags"."question_id") AND ("q"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."questions" "q"
  WHERE (("q"."id" = "question_tags"."question_id") AND ("q"."user_id" = "auth"."uid"())))));



CREATE POLICY "update_authenticated_own_rows" ON "public"."questions" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."rounds" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "rounds"."session_id") AND ("s"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "rounds"."session_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "update_authenticated_own_rows" ON "public"."sessions" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."tags" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_authenticated_own_rows" ON "public"."user_preferences" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_abandon_stale_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_abandon_stale_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_abandon_stale_sessions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_question_storage_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_question_storage_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_question_storage_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_flag_question_for_review"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_flag_question_for_review"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_flag_question_for_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_questions_search_vector"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_questions_search_vector"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_questions_search_vector"() TO "service_role";



GRANT ALL ON TABLE "public"."attempts" TO "anon";
GRANT ALL ON TABLE "public"."attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attempts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."category_stats_daily" TO "anon";
GRANT ALL ON TABLE "public"."category_stats_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."category_stats_daily" TO "service_role";



GRANT ALL ON TABLE "public"."generation_batches" TO "anon";
GRANT ALL ON TABLE "public"."generation_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."generation_batches" TO "service_role";



GRANT ALL ON TABLE "public"."question_categories" TO "anon";
GRANT ALL ON TABLE "public"."question_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."question_categories" TO "service_role";



GRANT ALL ON TABLE "public"."question_edits" TO "anon";
GRANT ALL ON TABLE "public"."question_edits" TO "authenticated";
GRANT ALL ON TABLE "public"."question_edits" TO "service_role";



GRANT ALL ON TABLE "public"."question_tags" TO "anon";
GRANT ALL ON TABLE "public"."question_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."question_tags" TO "service_role";



GRANT ALL ON TABLE "public"."questions" TO "anon";
GRANT ALL ON TABLE "public"."questions" TO "authenticated";
GRANT ALL ON TABLE "public"."questions" TO "service_role";



GRANT ALL ON TABLE "public"."rounds" TO "anon";
GRANT ALL ON TABLE "public"."rounds" TO "authenticated";
GRANT ALL ON TABLE "public"."rounds" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







