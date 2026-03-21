# REST API Plan — VARtownik

## 1. Resources

| Resource | DB Table(s) | Description |
|---|---|---|
| **Generation Batches** | `generation_batches` | AI quiz generation jobs (40 questions, 4 rounds) |
| **Questions** | `questions`, `question_edits`, `question_categories`, `question_tags` | Question pool (manual + AI-generated) |
| **Categories** | `categories` | Thematic categories for questions |
| **Tags** | `tags` | Optional flexible labels |
| **Sessions** | `sessions` | Training sessions linking a batch to rounds |
| **Rounds** | `rounds` | Individual rounds within a session (default 4 × 10 questions) |
| **Attempts** | `attempts` | Per-question answer record inside a round |
| **User Preferences** | `user_preferences` | Timer, category weights, storage limits |
| **Stats** | `category_stats_daily` | Denormalized analytics for dashboard |

---

## 2. Endpoints

All endpoints are prefixed with `/api`. All requests must include a valid session cookie (Supabase SSR auth). All list endpoints support pagination via `page` (default `1`) and `limit` (default `20`, max `100`) unless noted otherwise.

---

### 2.1 Generation Batches

#### `POST /api/generation-batches`
Trigger AI generation of a full quiz (40 questions / 4 rounds). Calls OpenRouter server-side. Implements the retry mechanism (max 2 attempts) on invalid JSON responses.

**Request body:**
```json
{
  "model": "gpt-4o",
  "provider": "openrouter",
  "prompt_version": "v1",
  "requested_questions_count": 40
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "status": "pending",
  "model": "gpt-4o",
  "provider": "openrouter",
  "prompt_version": "v1",
  "requested_questions_count": 40,
  "returned_questions_count": 0,
  "retry_count": 0,
  "estimated_cost_usd": null,
  "created_at": "2026-03-21T10:00:00Z"
}
```

**Response `202`** (returned when status becomes `success` after synchronous inline wait, includes created question IDs grouped by round):
```json
{
  "id": "uuid",
  "status": "success",
  "returned_questions_count": 40,
  "retry_count": 0,
  "estimated_cost_usd": 0.012345,
  "finished_at": "2026-03-21T10:00:28Z",
  "rounds": [
    { "position": 1, "question_ids": ["uuid", "..."] },
    { "position": 2, "question_ids": ["uuid", "..."] },
    { "position": 3, "question_ids": ["uuid", "..."] },
    { "position": 4, "question_ids": ["uuid", "..."] }
  ]
}
```

**Errors:**
- `400 Bad Request` — invalid model or prompt version
- `422 Unprocessable Entity` — AI returned malformed JSON after max retries
- `429 Too Many Requests` — rate limit exceeded for generation endpoint
- `502 Bad Gateway` — upstream OpenRouter API error

---

#### `GET /api/generation-batches/:id`
Poll status of a generation batch.

**Response `200`:**
```json
{
  "id": "uuid",
  "status": "success | pending | failed",
  "returned_questions_count": 40,
  "retry_count": 1,
  "estimated_cost_usd": 0.012345,
  "error_message": null,
  "finished_at": "2026-03-21T10:00:28Z"
}
```

**Errors:**
- `404 Not Found` — batch not found or belongs to another user

---

#### `GET /api/generation-batches`
List user's generation batches.

**Query params:** `page`, `limit`, `status` (`pending | success | failed`)

**Response `200`:**
```json
{
  "data": [ { ...batch } ],
  "pagination": { "page": 1, "limit": 20, "total": 7 }
}
```

---

### 2.2 Questions

#### `GET /api/questions`
List user's questions with filtering, sorting, and pagination.

**Query params:**
- `page`, `limit`
- `status` — `active | flagged | needs_review | verified | archived`
- `generated_type` — `manual | ai`
- `category_id` — filter by category UUID
- `tag_id` — filter by tag UUID
- `difficulty_score` — `1..5`
- `q` — full-text search in `question_text` / `correct_answer`
- `sort` — `created_at_desc` (default) | `created_at_asc` | `difficulty_asc` | `difficulty_desc`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "generated_type": "ai",
      "status": "active",
      "question_text": "...",
      "correct_answer": { "primary": "...", "synonyms": [] },
      "difficulty_score": 4,
      "image_path": null,
      "source_model": "gpt-4o",
      "categories": [ { "id": "uuid", "name": "Ekstraklasa" } ],
      "tags": [],
      "created_at": "2026-03-21T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 312 }
}
```

---

#### `POST /api/questions`
Manually create a question.

**Request body:**
```json
{
  "question_text": "Który piłkarz strzelił ...",
  "correct_answer": {
    "primary": "Robert Lewandowski",
    "synonyms": ["Lewandowski", "RL9"]
  },
  "difficulty_score": 3,
  "category_ids": ["uuid"],
  "tag_ids": [],
  "image_path": null
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "generated_type": "manual",
  "status": "active",
  "question_text": "...",
  "correct_answer": { "primary": "...", "synonyms": [] },
  "difficulty_score": 3,
  "categories": [],
  "tags": [],
  "created_at": "2026-03-21T10:00:00Z"
}
```

**Errors:**
- `400 Bad Request` — validation failure (e.g. text too short, difficulty out of range)
- `409 Conflict` — duplicate `content_hash` for this user
- `422 Unprocessable Entity` — storage limit reached (`user_preferences.storage_limit_questions`)

---

#### `GET /api/questions/:id`
Get a single question with categories and edit history.

**Response `200`:**
```json
{
  "id": "uuid",
  "question_text": "...",
  "correct_answer": { "primary": "...", "synonyms": [] },
  "difficulty_score": 4,
  "status": "active",
  "categories": [],
  "tags": [],
  "edit_history": [
    {
      "id": "uuid",
      "change_reason": "Halucynacja AI — zły rok",
      "created_at": "2026-03-21T11:00:00Z"
    }
  ],
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T11:00:00Z"
}
```

**Errors:**
- `404 Not Found`

---

#### `PATCH /api/questions/:id`
Update a question (includes flagging). Creates an `question_edits` audit record automatically.

**Request body** (all fields optional):
```json
{
  "question_text": "...",
  "correct_answer": { "primary": "..." },
  "difficulty_score": 4,
  "status": "flagged",
  "category_ids": ["uuid"],
  "tag_ids": [],
  "change_reason": "Poprawka treści pytania"
}
```

**Response `200`:** Updated question object (same shape as `GET /api/questions/:id`)

**Errors:**
- `400 Bad Request` — validation failure
- `404 Not Found`

---

#### `DELETE /api/questions/:id`
Delete a question. Fails if the question has associated attempts (to preserve history integrity). Use `status: archived` instead to soft-delete.

**Response `204 No Content`**

**Errors:**
- `404 Not Found`
- `409 Conflict` — question has existing attempt records

---

### 2.3 Categories

#### `GET /api/categories`
List user's categories.

**Query params:** `page`, `limit`, `sort` (`name_asc` default | `created_at_desc`)

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Historia MŚ/Euro",
      "slug": "historia-ms-euro",
      "description": null,
      "created_at": "2026-03-21T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5 }
}
```

---

#### `POST /api/categories`
Create a new category.

**Request body:**
```json
{
  "name": "Ekstraklasa",
  "description": "Pytania o polską ekstraklasę"
}
```

**Response `201`:** Category object

**Errors:**
- `400 Bad Request` — name too short/long
- `409 Conflict` — slug already exists for this user

---

#### `GET /api/categories/:id`
Get a single category.

**Response `200`:** Category object

---

#### `PATCH /api/categories/:id`
Update a category name or description.

**Request body:**
```json
{ "name": "Ekstraklasa 2.0", "description": "updated" }
```

**Response `200`:** Updated category object

**Errors:**
- `400 Bad Request`, `404 Not Found`, `409 Conflict`

---

#### `DELETE /api/categories/:id`
Delete a category. Removes all `question_categories` associations.

**Response `204 No Content`**

**Errors:**
- `404 Not Found`

---

### 2.4 Tags

#### `GET /api/tags`
**Response `200`:** `{ "data": [ { "id": "uuid", "name": "finals", "created_at": "..." } ] }`

#### `POST /api/tags`
**Request:** `{ "name": "finals" }`  
**Response `201`:** Tag object  
**Errors:** `409 Conflict` — tag name already exists (case-insensitive) for user

#### `DELETE /api/tags/:id`
**Response `204 No Content`**

---

### 2.5 Sessions

#### `POST /api/sessions`
Start a new training session linked to a successfully completed generation batch.

**Request body:**
```json
{
  "generation_batch_id": "uuid",
  "timer_seconds": 20
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "status": "in_progress",
  "generation_batch_id": "uuid",
  "timer_seconds": 20,
  "total_rounds": 4,
  "questions_per_round": 10,
  "started_at": "2026-03-21T10:00:00Z",
  "rounds": [
    { "id": "uuid", "position": 1, "status": "in_progress" },
    { "id": "uuid", "position": 2, "status": "in_progress" },
    { "id": "uuid", "position": 3, "status": "in_progress" },
    { "id": "uuid", "position": 4, "status": "in_progress" }
  ]
}
```

**Errors:**
- `400 Bad Request` — `timer_seconds` out of [15, 30] range
- `404 Not Found` — batch not found
- `422 Unprocessable Entity` — batch status is not `success`

> **Note:** Server-side trigger automatically sets any existing `in_progress` sessions for the user to `abandoned` before inserting the new session.

---

#### `GET /api/sessions`
List past sessions for dashboard (US-006).

**Query params:** `page`, `limit`, `status` (`in_progress | completed | abandoned`)

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "status": "completed",
      "timer_seconds": 20,
      "total_rounds": 4,
      "questions_per_round": 10,
      "started_at": "2026-03-21T10:00:00Z",
      "completed_at": "2026-03-21T10:25:00Z",
      "score_summary": {
        "total_questions": 40,
        "knew_count": 28,
        "did_not_know_count": 12,
        "accuracy_percent": 70
      }
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 23 }
}
```

---

#### `GET /api/sessions/:id`
Get a session with round summaries.

**Response `200`:** Full session object including round statuses and score summary

**Errors:**
- `404 Not Found`

---

#### `PATCH /api/sessions/:id`
Abandon a session explicitly (e.g. user navigates away).

**Request body:**
```json
{ "status": "abandoned" }
```

**Response `200`:** Updated session object

**Errors:**
- `400 Bad Request` — only `abandoned` is a valid transition from `in_progress`
- `404 Not Found`

---

### 2.6 Rounds

#### `GET /api/sessions/:sessionId/rounds/:position`
Get a specific round with its questions. **Correct answers are omitted while `status = in_progress`** (revealed only when `status = completed`).

**Response `200`:**
```json
{
  "id": "uuid",
  "position": 1,
  "status": "in_progress",
  "timer_seconds": 20,
  "questions": [
    {
      "position": 1,
      "question_id": "uuid",
      "question_text": "...",
      "difficulty_score": 4,
      "categories": [ { "name": "Ekstraklasa" } ],
      "correct_answer": null
    }
  ],
  "started_at": "2026-03-21T10:00:00Z"
}
```

When `status = completed`, `correct_answer` is populated per question:
```json
"correct_answer": { "primary": "Robert Lewandowski", "synonyms": [] }
```

**Errors:**
- `404 Not Found`

---

#### `POST /api/sessions/:sessionId/rounds/:roundId/complete`
Mark a round as completed, revealing answers. Only allowed after all 10 attempts have been recorded (or timer expired for each). Prerequisite for accessing answers and moving to the next round.

**Response `200`:** Updated round object with `status: "completed"` and `correct_answer` populated for each question.

**Errors:**
- `400 Bad Request` — not all questions in round have been attempted
- `404 Not Found`
- `409 Conflict` — round already completed

---

### 2.7 Attempts

#### `POST /api/rounds/:roundId/attempts`
Submit a scratchpad answer for a single question during an active round (US-003).

**Request body:**
```json
{
  "question_id": "uuid",
  "position": 3,
  "scratchpad": "Lewandowski 2021",
  "time_taken_ms": 14500,
  "timer_expired": false
}
```

**Response `201`:**
```json
{
  "id": 12345,
  "question_id": "uuid",
  "position": 3,
  "scratchpad": "Lewandowski 2021",
  "time_taken_ms": 14500,
  "timer_expired": false,
  "verdict": null,
  "is_flagged_by_user": false,
  "created_at": "2026-03-21T10:02:14Z"
}
```

**Errors:**
- `400 Bad Request` — position already occupied in this round, round not `in_progress`
- `404 Not Found` — round not found or question_id invalid
- `409 Conflict` — attempt for this position already exists

---

#### `PATCH /api/attempts/:id`
Set self-assessment verdict or flag a question after round completion (US-004, US-005).

**Request body:**
```json
{
  "verdict": "knew",
  "is_flagged_by_user": false,
  "flag_reason": null
}
```

**Response `200`:** Updated attempt object

**Errors:**
- `400 Bad Request` — round still `in_progress` (verdict can only be set after round is completed), invalid verdict value
- `404 Not Found`

---

### 2.8 User Preferences

#### `GET /api/user/preferences`
Get current user's preferences.

**Response `200`:**
```json
{
  "user_id": "uuid",
  "default_timer_seconds": 20,
  "category_weights": {
    "ekstraklasa": 0.3,
    "historia-ms-euro": 0.2,
    "statystyki": 0.2,
    "pilka-zagraniczna": 0.2,
    "reprezentacja-polski": 0.1
  },
  "storage_limit_questions": 5000,
  "storage_limit_images_bytes": 1073741824,
  "updated_at": "2026-01-01T00:00:00Z"
}
```

---

#### `PUT /api/user/preferences`
Create or update user preferences (upsert).

**Request body:**
```json
{
  "default_timer_seconds": 25,
  "category_weights": {
    "ekstraklasa": 0.4,
    "historia-ms-euro": 0.2,
    "statystyki": 0.15,
    "pilka-zagraniczna": 0.15,
    "reprezentacja-polski": 0.1
  }
}
```

**Response `200`:** Updated preferences object

**Errors:**
- `400 Bad Request` — `default_timer_seconds` not in [15, 30], `category_weights` not a JSON object

---

### 2.9 Stats

#### `GET /api/stats/overview`
Overall user performance summary for dashboard (US-006).

**Response `200`:**
```json
{
  "total_attempts": 1240,
  "knew_count": 867,
  "did_not_know_count": 373,
  "overall_accuracy_percent": 69.9,
  "total_sessions_completed": 31,
  "flagged_questions_pending": 4
}
```

---

#### `GET /api/stats/categories`
Per-category effectiveness breakdown (US-006).

**Query params:** `from` (date, default 30 days ago), `to` (date, default today)

**Response `200`:**
```json
{
  "data": [
    {
      "category_id": "uuid",
      "category_name": "Ekstraklasa",
      "attempts_count": 320,
      "knew_count": 210,
      "did_not_know_count": 110,
      "accuracy_percent": 65.6
    }
  ]
}
```

---

## 3. Authentication and Authorization

### Mechanism
Supabase Auth with **cookie-based SSR sessions** (`@supabase/ssr`). The middleware (`src/middleware/index.ts`) runs on every request, calls `supabase.auth.getUser()`, and populates `context.locals.user`.

### Implementation Details

- **All `/api/*` endpoints** require an authenticated session. Requests without a valid session cookie receive `401 Unauthorized`.
- **Row Level Security (RLS)** is enforced at the database layer for every table. All Supabase queries in API routes execute as the authenticated user — RLS policies use `auth.uid()` to ensure users can only read/write their own data (US-001, criterion 4).
- API routes use the SSR Supabase client (`createClient` from `@/lib/supabase`) which passes the cookie-based session, so RLS is automatically applied.
- **No anonymous access** — `anon` role is blocked on all domain tables via `using (false)` RLS policies.
- The OpenRouter API key is server-only (`astro:env/server`), never sent to the client.

### Token Lifecycle
- Sign-in: `POST /api/auth/signin` (sets HttpOnly session cookie)
- Sign-out: `POST /api/auth/signout` (clears cookie)
- Session refresh: handled transparently by `@supabase/ssr`

---

## 4. Validation and Business Logic

### Request Validation (Zod)
All API route handlers validate their input with Zod schemas before touching the database.

### Per-Resource Validation Rules

| Resource | Field | Rule |
|---|---|---|
| `user_preferences` | `default_timer_seconds` | integer, 15–30 |
| `user_preferences` | `category_weights` | JSON object, values must sum to ≤ 1.0 |
| `categories` | `name` | string, 2–120 chars |
| `questions` | `question_text` | string, min 10 chars |
| `questions` | `difficulty_score` | integer, 1–5 |
| `questions` | `correct_answer` | JSON object with at least `primary` key |
| `generation_batches` | `requested_questions_count` | positive integer, default 40 |
| `sessions` | `timer_seconds` | integer, 15–30 |
| `rounds` | `position` | positive integer |
| `attempts` | `position` | positive integer, unique per round |
| `attempts` | `time_taken_ms` | non-negative integer |
| `attempts` | `verdict` | `"knew"` or `"did_not_know"` or null |

### Key Business Logic

#### AI Generation (`POST /api/generation-batches`)
1. Server calls OpenRouter API with few-shot prompt.
2. If JSON parsing fails, increments `retry_count` and retries (max 2 retries → `422` error on third failure).
3. Each returned question is deduped by `content_hash` (SHA-256 of normalized `question_text`) — duplicates are skipped, not errored.
4. Questions are distributed into `rounds` (4 × 10) and `question_categories` rows created automatically.
5. `generation_batches.status` transitions: `pending` → `success` or `failed`.

#### Session Creation (`POST /api/sessions`)
- A DB trigger fires before insert: all existing `in_progress` sessions for the user are transitioned to `abandoned` with `abandoned_at = now()` (US-007).
- `timer_seconds` copied from `user_preferences.default_timer_seconds` if not provided.

#### Round Completion (`POST /api/sessions/:sessionId/rounds/:roundId/complete`)
- Only allowed when all `questions_per_round` attempts exist for the round.
- Sets `rounds.completed_at = now()` and `rounds.status = 'completed'`.
- When the final round (position = `total_rounds`) completes, the session is automatically marked `completed` with `completed_at = now()`.
- `category_stats_daily` rows are upserted for each question's category (denormalized analytics update).

#### Verdict Submission (`PATCH /api/attempts/:id`)
- Only allowed after the parent round has `status = 'completed'`.
- If `is_flagged_by_user = true`, the referenced `questions.status` is set to `needs_review` (DB trigger).
- Flagged questions (`status = flagged | needs_review`) are excluded from future AI generation sampling.

#### Question Storage Limit
- A DB trigger on `insert on questions` checks `user_preferences.storage_limit_questions`. If the user already has `>= limit` questions, the insert is rejected (surfaced as `422` to the client).

#### Answer Revelation Policy
- `GET /api/sessions/:sessionId/rounds/:position` masks `correct_answer: null` for all questions while `round.status = 'in_progress'`.
- After explicit completion (`POST .../complete`) the answers are included in the response — preventing pre-emptive answer lookup (US-003, criterion 5).

#### Session Interruption (US-007)
- No round state is stored client-side in `localStorage`. The client submits individual attempt records per question via `POST /api/rounds/:roundId/attempts`.
- If the user refreshes mid-round, the partially-recorded round remains `in_progress` but the client has no local state to resume from — the UI navigates to the dashboard on mount if no active session context is found.
- Incomplete rounds are excluded from stat aggregations (`category_stats_daily` is only updated on round completion).
