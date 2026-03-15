# Schemat bazy danych PostgreSQL dla VARtownik

## 1. Lista tabel z kolumnami, typami danych i ograniczeniami

### 1.1. Typy ENUM

- `generated_type_enum`: `manual`, `ai`
- `question_status_enum`: `active`, `flagged`, `needs_review`, `verified`, `archived`
- `session_status_enum`: `in_progress`, `completed`, `abandoned`
- `attempt_verdict_enum`: `knew`, `did_not_know`

### 1.2. `user_preferences`

Cel: ustawienia użytkownika, limity i wagi kategorii do losowania pytań.

Kolumny:
- `user_id uuid primary key references auth.users(id) on delete cascade`
- `category_weights jsonb not null default '{}'::jsonb`
- `default_timer_seconds smallint not null default 20 check (default_timer_seconds between 15 and 30)`
- `storage_limit_questions integer not null default 5000 check (storage_limit_questions > 0)`
- `storage_limit_images_bytes bigint not null default 1073741824 check (storage_limit_images_bytes > 0)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Ograniczenia:
- `check (jsonb_typeof(category_weights) = 'object')`

### 1.3. `categories`

Cel: kategorie tematyczne pytań (N:M z pytaniami).

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `slug text not null`
- `description text null`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `unique (user_id, slug)`
- `check (char_length(name) between 2 and 120)`

### 1.4. `tags` (opcjonalny moduł filtrowania)

Cel: elastyczne tagowanie pytań obok sztywnych kategorii.

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `unique (user_id, lower(name))`

### 1.5. `questions`

Cel: główna tabela pytań (manualnych i generowanych przez AI).

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `generated_type generated_type_enum not null`
- `status question_status_enum not null default 'active'`
- `question_text text not null`
- `correct_answer jsonb not null`
- `difficulty_score smallint not null check (difficulty_score between 1 and 5)`
- `image_path text null` (ścieżka do obiektu w Supabase Storage `quiz-images`)
- `content_hash text not null`
- `source_model text null` (np. `gpt-4o`, `claude-3.5-sonnet`)
- `generation_metadata jsonb null`
- `schema_version smallint not null default 1`
- `last_verified_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Ograniczenia:
- `unique (user_id, content_hash)`
- `check (char_length(question_text) >= 10)`
- `check (jsonb_typeof(correct_answer) = 'object')`
- `check (generation_metadata is null or jsonb_typeof(generation_metadata) = 'object')`

Rekomendowany format `correct_answer` (JSONB):
- `primary` (string)
- `synonyms` (array string)
- `weighted_synonyms` (array obiektów `{ value: string, weight: numeric }`) dla przyszłej walidacji punktowej

### 1.6. `question_categories`

Cel: tabela łącząca N:M dla pytań i kategorii.

Kolumny:
- `question_id uuid not null references questions(id) on delete cascade`
- `category_id uuid not null references categories(id) on delete cascade`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `primary key (question_id, category_id)`

### 1.7. `question_tags` (dla tabeli `tags`)

Cel: tabela łącząca N:M dla pytań i tagów.

Kolumny:
- `question_id uuid not null references questions(id) on delete cascade`
- `tag_id uuid not null references tags(id) on delete cascade`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `primary key (question_id, tag_id)`

### 1.8. `question_edits`

Cel: audyt zmian pytań (manualna korekta, flagowanie, poprawki po halucynacji AI).

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `question_id uuid not null references questions(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `change_reason text not null`
- `old_payload jsonb not null`
- `new_payload jsonb not null`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `check (jsonb_typeof(old_payload) = 'object')`
- `check (jsonb_typeof(new_payload) = 'object')`

### 1.9. `generation_batches`

Cel: kontrola kosztów i jakości procesu generowania AI dla paczek 40 pytań.

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `provider text not null` (np. `openrouter`)
- `model text not null`
- `prompt_version text not null`
- `schema_version smallint not null default 1`
- `requested_questions_count smallint not null default 40 check (requested_questions_count > 0)`
- `returned_questions_count smallint not null default 0 check (returned_questions_count >= 0)`
- `retry_count smallint not null default 0 check (retry_count between 0 and 2)`
- `status text not null check (status in ('pending', 'success', 'failed'))`
- `estimated_cost_usd numeric(12,6) null`
- `error_message text null`
- `request_payload jsonb not null`
- `response_payload jsonb null`
- `created_at timestamptz not null default now()`
- `finished_at timestamptz null`

Ograniczenia:
- `check (jsonb_typeof(request_payload) = 'object')`
- `check (response_payload is null or jsonb_typeof(response_payload) in ('object', 'array'))`

### 1.10. `sessions`

Cel: sesja treningowa użytkownika (docelowo 40 pytań / 4 rundy).

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `generation_batch_id uuid null references generation_batches(id) on delete set null`
- `status session_status_enum not null default 'in_progress'`
- `timer_seconds smallint not null check (timer_seconds between 15 and 30)`
- `total_rounds smallint not null default 4 check (total_rounds > 0)`
- `questions_per_round smallint not null default 10 check (questions_per_round > 0)`
- `started_at timestamptz not null default now()`
- `completed_at timestamptz null`
- `abandoned_at timestamptz null`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `check ((status = 'completed' and completed_at is not null) or status <> 'completed')`
- `check ((status = 'abandoned' and abandoned_at is not null) or status <> 'abandoned')`

### 1.11. `rounds`

Cel: runda w obrębie sesji (1..N, domyślnie 4).

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `session_id uuid not null references sessions(id) on delete cascade`
- `position smallint not null check (position > 0)`
- `status text not null check (status in ('in_progress', 'completed'))`
- `started_at timestamptz not null default now()`
- `completed_at timestamptz null`
- `created_at timestamptz not null default now()`

Ograniczenia:
- `unique (session_id, position)`

### 1.12. `attempts` (partycjonowana po miesiącu)

Cel: historia odpowiedzi użytkownika na każde pytanie w rundzie.

Strategia partycjonowania:
- `partition by range (created_at)`
- miesięczne partycje, np. `attempts_2026_01`, `attempts_2026_02`

Kolumny:
- `id bigint generated always as identity`
- `created_at timestamptz not null default now()` (klucz partycjonowania)
- `user_id uuid not null references auth.users(id) on delete cascade`
- `session_id uuid not null references sessions(id) on delete cascade`
- `round_id uuid not null references rounds(id) on delete cascade`
- `question_id uuid not null references questions(id) on delete restrict`
- `position smallint not null check (position > 0)`
- `scratchpad text null`
- `time_taken_ms integer not null check (time_taken_ms >= 0)`
- `timer_expired boolean not null default false`
- `verdict attempt_verdict_enum null`
- `is_flagged_by_user boolean not null default false`
- `flag_reason text null`
- `question_text_snapshot text not null`
- `correct_answer_snapshot jsonb not null`
- `difficulty_score_snapshot smallint not null check (difficulty_score_snapshot between 1 and 5)`

Ograniczenia:
- `primary key (created_at, id)`
- `unique (round_id, position)`
- `check (verdict is not null or timer_expired = true or scratchpad is not null)`
- `check (jsonb_typeof(correct_answer_snapshot) = 'object')`

### 1.13. `category_stats_daily` (denormalizacja analityczna)

Cel: szybkie dashboardy skuteczności per kategoria bez kosztownych agregacji runtime.

Kolumny:
- `stat_date date not null`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid not null references categories(id) on delete cascade`
- `attempts_count integer not null default 0`
- `knew_count integer not null default 0`
- `did_not_know_count integer not null default 0`
- `updated_at timestamptz not null default now()`

Ograniczenia:
- `primary key (stat_date, user_id, category_id)`
- `check (attempts_count >= 0 and knew_count >= 0 and did_not_know_count >= 0)`

## 2. Relacje między tabelami

- `auth.users (1) -> (1) user_preferences`
- `auth.users (1) -> (N) categories`
- `auth.users (1) -> (N) tags`
- `auth.users (1) -> (N) questions`
- `questions (N) <-> (N) categories` przez `question_categories`
- `questions (N) <-> (N) tags` przez `question_tags`
- `questions (1) -> (N) question_edits`
- `auth.users (1) -> (N) question_edits`
- `auth.users (1) -> (N) generation_batches`
- `auth.users (1) -> (N) sessions`
- `generation_batches (1) -> (N) sessions` (opcjonalne powiązanie)
- `sessions (1) -> (N) rounds`
- `rounds (1) -> (N) attempts`
- `questions (1) -> (N) attempts` (snapshoty zabezpieczają historię przy zmianach pytania)
- `auth.users (1) -> (N) attempts`
- `categories (1) -> (N) category_stats_daily`
- `auth.users (1) -> (N) category_stats_daily`

Kardynalności kluczowe biznesowo:
- Jedna sesja zawiera wiele rund, jedna runda wiele prób.
- Jedno pytanie może należeć do wielu kategorii.
- Jedna próba dotyczy dokładnie jednego pytania i jednej pozycji w rundzie.

## 3. Indeksy

### 3.1. Wyszukiwanie i unikalność

- `create unique index ux_categories_user_slug on categories (user_id, slug);`
- `create unique index ux_categories_user_name_ci on categories (user_id, lower(name));`
- `create unique index ux_questions_user_content_hash on questions (user_id, content_hash);`
- `create unique index ux_attempts_round_position on attempts (round_id, position);`

### 3.2. Statystyki i dashboard

- `create index ix_attempts_user_created_at on attempts (user_id, created_at desc);`
- `create index ix_attempts_user_verdict_created on attempts (user_id, verdict, created_at desc);`
- `create index ix_attempts_question on attempts (question_id);`
- `create index ix_rounds_session_position on rounds (session_id, position);`
- `create index ix_sessions_user_status_started on sessions (user_id, status, started_at desc);`
- `create index ix_category_stats_user_category_date on category_stats_daily (user_id, category_id, stat_date desc);`

### 3.3. AI i operacje CRUD

- `create index ix_generation_batches_user_created on generation_batches (user_id, created_at desc);`
- `create index ix_generation_batches_status on generation_batches (status);`
- `create index ix_question_edits_question_created on question_edits (question_id, created_at desc);`
- `create index ix_questions_status_created on questions (user_id, status, created_at desc);`

### 3.4. Full Text Search

- kolumna generowana: `questions.search_vector tsvector generated always as (to_tsvector('simple', coalesce(question_text,'') || ' ' || coalesce(correct_answer::text,''))) stored`
- `create index ix_questions_search_vector on questions using gin (search_vector);`

### 3.5. JSONB

- `create index ix_questions_correct_answer_gin on questions using gin (correct_answer jsonb_path_ops);`
- `create index ix_generation_batches_request_payload_gin on generation_batches using gin (request_payload jsonb_path_ops);`

## 4. Zasady PostgreSQL (RLS)

Założenie: wszystkie tabele domenowe mają RLS `enabled` i `force row level security`.

### 4.1. Tabele prywatne użytkownika

Dotyczy: `user_preferences`, `categories`, `tags`, `questions`, `question_categories`, `question_tags`, `question_edits`, `generation_batches`, `sessions`, `rounds`, `attempts`, `category_stats_daily`.

Polityki (osobno per operacja i per rola, bez łączenia):
- `select_authenticated_own_rows`: `to authenticated using (user_id = auth.uid())`
- `insert_authenticated_own_rows`: `to authenticated with check (user_id = auth.uid())`
- `update_authenticated_own_rows`: `to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())`
- `delete_authenticated_own_rows`: `to authenticated using (user_id = auth.uid())`

Polityki dla `anon`:
- `select_anon_none`: `to anon using (false)`
- `insert_anon_none`: `to anon with check (false)`
- `update_anon_none`: `to anon using (false) with check (false)`
- `delete_anon_none`: `to anon using (false)`

### 4.2. Tabele łączące bez własnego `user_id`

Dla `question_categories`, `question_tags`, `rounds` można stosować polityki przez istnienie rekordu nadrzędnego użytkownika:
- `using (exists (select 1 from questions q where q.id = question_id and q.user_id = auth.uid()))`
- dla `rounds`: `using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))`

### 4.3. Storage (Supabase bucket `quiz-images`)

Rekomendowane polityki w `storage.objects`:
- odczyt: tylko właściciel pliku (`owner = auth.uid()`) lub ścieżka prefiksowana `auth.uid()`
- zapis/aktualizacja/usuwanie: tylko właściciel
- konwencja ścieżki: `quiz-images/{user_id}/{question_id}/{filename}`

### 4.4. Funkcje i triggery bezpieczeństwa

- funkcje `security definer` tylko tam, gdzie konieczne (np. automatyczne porzucanie starych sesji)
- zawsze `set search_path` jawnie w funkcjach
- brak bezpośrednich uprawnień `anon` do funkcji mutujących dane użytkownika

## 5. Dodatkowe uwagi i decyzje projektowe

- Normalizacja: model spełnia 3NF dla danych transakcyjnych; kontrolowana denormalizacja tylko w `category_stats_daily` dla wydajnych dashboardów.
- Snapshotting: `attempts` przechowuje kopię pytania i odpowiedzi, aby historyczne wyniki nie zmieniały się po edycji pytań.
- Skalowalność zapisu: `attempts` partycjonowane miesięcznie, co utrzyma stabilną wydajność przy dużej historii.
- Spójność sesji: trigger `before insert on sessions` ustawia starsze `in_progress` sesje użytkownika na `abandoned`.
- Kontrola jakości pytań: trigger po `insert/update` w `attempts` ustawia `questions.status = 'needs_review'`, gdy `is_flagged_by_user = true`.
- Limity danych: trigger `before insert on questions` sprawdza limity z `user_preferences.storage_limit_questions`.
- Generowanie AI: `generation_batches` wspiera retry do 2 prób, monitoring kosztu i audyt request/response payload.
- Usuwanie konta: `on delete cascade` dla wszystkich tabel użytkownika, zgodnie z prywatnym charakterem danych.
- Nierozstrzygnięte biznesowo (obsłużone technicznie):
  - tagi są opcjonalne (`tags`, `question_tags`) i mogą zostać wyłączone bez naruszenia rdzenia modelu,
  - `correct_answer` wspiera zarówno proste synonimy, jak i wariant ważony.
