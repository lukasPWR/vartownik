# API Endpoint Implementation Plan: GET /api/questions/:id

## 1. Przegląd punktu końcowego

Endpoint zwraca pełne dane pojedynczego pytania należącego do zalogowanego użytkownika — razem z powiązanymi kategoriami, tagami i historią edycji (`question_edits`). Odpowiada na potrzeby widoku szczegółów pytania oraz formularza edycji. Dostęp do zasobu innego użytkownika zostaje zablokowany przez RLS na poziomie bazy danych.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/questions/:id`
- **Parametry:**
  - **Wymagane:** `id` (UUID — segment ścieżki)
  - **Opcjonalne:** brak
- **Request Body:** brak

---

## 3. Wykorzystywane typy

Wszystkie typy istnieją już w `src/types.ts` — nie jest wymagane dodawanie nowych.

| Typ | Źródło | Rola |
|---|---|---|
| `QuestionDetailDTO` | `src/types.ts` | Kształt odpowiedzi 200 |
| `QuestionDTO` | `src/types.ts` | Baza (klasa bazowa `QuestionDetailDTO`) |
| `QuestionEditHistoryDTO` | `src/types.ts` | Wpis historii zmian |
| `CorrectAnswerDTO` | `src/types.ts` | Typowanie kolumny JSON `correct_answer` |
| `CategoryRefDTO` | `src/types.ts` | Slim ref kategorii w odpowiedzi |
| `GeneratedType`, `QuestionStatus` | `src/types.ts` | Enumy DB |
| `Tables<"tags">` | `src/db/database.types.ts` | Pick dla tagów |
| `SupabaseClientType` | `src/db/supabase.client.ts` | Klient Supabase dla serwisu |

```typescript
// Kształt odpowiedzi:
interface QuestionDetailDTO extends QuestionDTO {
  edit_history: QuestionEditHistoryDTO[]; // Pick<question_edits, "id"|"change_reason"|"created_at">
  updated_at: string;
}
```

---

## 4. Szczegóły odpowiedzi

### 200 OK

```json
{
  "id": "uuid",
  "generated_type": "ai",
  "status": "active",
  "question_text": "Który piłkarz strzelił ...",
  "correct_answer": { "primary": "Robert Lewandowski", "synonyms": ["RL9"] },
  "difficulty_score": 4,
  "image_path": null,
  "source_model": "gpt-4o",
  "categories": [{ "id": "uuid", "name": "Ekstraklasa" }],
  "tags": [{ "id": "uuid", "name": "finals" }],
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

### 401 Unauthorized

```json
{ "error": "Unauthorized" }
```

### 404 Not Found

```json
{ "error": "Question not found" }
```

### 500 Internal Server Error

```json
{ "error": "Internal server error" }
```

---

## 5. Przepływ danych

```
[GET /api/questions/:id]
        │
        ▼
[src/pages/api/questions/[id].ts]
  1. Sprawdź locals.user → 401 jeśli brak
  2. Waliduj params.id jako UUID (Zod) → 400 jeśli błędne
  3. Wywołaj getQuestionById(supabase, userId, id)
        │
        ▼
[src/lib/services/questions.service.ts → getQuestionById()]
  4. Zapytanie SELECT do Supabase z JOIN:
       questions
         + question_categories → categories(id, name)
         + question_tags → tags(id, name)
         + question_edits(id, change_reason, created_at)
     .eq("id", id)
     .eq("user_id", userId)   ← RLS backup
     .single()
  5. Jeśli data === null lub error (PGRST116) → throw NotFoundError
  6. Jeśli inny błąd → rzuć dalej (500)
  7. Zmapuj raw row na QuestionDetailDTO
        │
        ▼
[src/pages/api/questions/[id].ts]
  8. Zwróć Response 200 z QuestionDetailDTO
```

### Struktura zapytania Supabase

```typescript
const { data, error } = await supabase
  .from("questions")
  .select(
    `id, generated_type, status, question_text, correct_answer,
     difficulty_score, image_path, source_model, created_at, updated_at,
     question_categories(
       categories(id, name)
     ),
     question_tags(
       tags(id, name)
     ),
     question_edits(
       id, change_reason, created_at
     )`
  )
  .eq("id", id)
  .eq("user_id", userId)
  .order("created_at", { ascending: false, referencedTable: "question_edits" })
  .single();
```

### Mapowanie wyniku

```typescript
interface RawRow {
  id: string;
  generated_type: GeneratedType;
  status: QuestionStatus;
  question_text: string;
  correct_answer: unknown;
  difficulty_score: number;
  image_path: string | null;
  source_model: string | null;
  created_at: string;
  updated_at: string;
  question_categories: { categories: CategoryRefDTO | null }[];
  question_tags: { tags: Pick<Tables<"tags">, "id" | "name"> | null }[];
  question_edits: QuestionEditHistoryDTO[];
}

const result: QuestionDetailDTO = {
  id: row.id,
  generated_type: row.generated_type,
  status: row.status,
  question_text: row.question_text,
  correct_answer: row.correct_answer as CorrectAnswerDTO,
  difficulty_score: row.difficulty_score,
  image_path: row.image_path,
  source_model: row.source_model,
  created_at: row.created_at,
  updated_at: row.updated_at,
  categories: row.question_categories
    .map((qc) => qc.categories)
    .filter((c): c is CategoryRefDTO => c !== null),
  tags: row.question_tags
    .map((qt) => qt.tags)
    .filter((t): t is Pick<Tables<"tags">, "id" | "name"> => t !== null),
  edit_history: row.question_edits ?? [],
};
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnianie** — endpoint weryfikuje `locals.user` (ustawiane przez middleware). Brak użytkownika → `401`.
2. **Autoryzacja (RLS)** — polityki `SELECT` na tabeli `questions` filtrują wiersze do `auth.uid() = user_id`. Klauzula `.eq("user_id", userId)` w serwisie pełni rolę defence-in-depth — jeśli sesja SSR nie trafia do RLS, zapytanie i tak zwróci brak danych.
3. **Walidacja ID** — `id` pochodzi z segmentu ścieżki i musi przejść walidację `z.string().uuid()` zanim trafi do DB, co eliminuje ryzyko SQL injection i nieoczekiwanych błędów DB.
4. **Brak ujawniania wewnętrznych błędów** — wyjątki DB logowane serwer-side; klient otrzymuje tylko `"Internal server error"`.
5. **Brak wrażliwych pól** — `user_id`, `content_hash`, `generation_metadata` nie są eksponowane w odpowiedzi 200.

---

## 7. Obsługa błędów

| Scenariusz | Kod | Odpowiedź |
|---|---|---|
| Brak sesji (`locals.user` null) | 401 | `{ "error": "Unauthorized" }` |
| `id` nie jest poprawnym UUID | 400 | `{ "error": "Validation failed", "issues": [...] }` |
| Pytanie nie istnieje lub należy do innego użytkownika | 404 | `{ "error": "Question not found" }` |
| Błąd Supabase (sieć, timeout, inny kod DB) | 500 | `{ "error": "Internal server error" }` |

Kod `PGRST116` (Supabase — `.single()` nie zwróciło wiersza) należy mapować na `404`.

Dodać klasę `NotFoundError` do `src/lib/errors.ts`:

```typescript
export class NotFoundError extends Error {
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
```

---

## 8. Rozważania dotyczące wydajności

1. **Jedno zapytanie z JOIN** — wszystkie dane (pytanie, kategorie, tagi, historia edycji) pobierane w jednym `SELECT`, bez N+1.
2. **Indeks PK na `questions.id`** — lookuppo `id` korzysta z istniejącego indeksu klucza głównego.
3. **Indeks na `question_edits.question_id`** — powinien istnieć (lub zostać dodany migracyjnie), żeby JOIN historii edycji był wydajny.
4. **Sortowanie historii edycji** — `created_at DESC` w `question_edits` ogranicza czas sortowania po stronie DB; brak paginacji historii jest akceptowalny przy typowej liczbie edycji (<50).
5. **Brak cache'owania** — endpoint rzadko wywoływany (widok szczegółów), nie wymaga dodatkowego cache.

---

## 9. Etapy implementacji

### Krok 1 — Dodaj `NotFoundError` do `src/lib/errors.ts`

```typescript
export class NotFoundError extends Error {
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
```

---

### Krok 2 — Dodaj funkcję `getQuestionById` w `src/lib/services/questions.service.ts`

```typescript
import { NotFoundError } from "@/lib/errors";
import type { QuestionDetailDTO, QuestionEditHistoryDTO } from "@/types";

/**
 * Returns a single question (with categories, tags, and edit history)
 * owned by the given user.
 *
 * @throws {NotFoundError} when no question with the given id exists for this user.
 */
export async function getQuestionById(
  supabase: SupabaseClientType,
  userId: string,
  id: string
): Promise<QuestionDetailDTO> {
  const { data: row, error } = await supabase
    .from("questions")
    .select(
      `id, generated_type, status, question_text, correct_answer,
       difficulty_score, image_path, source_model, created_at, updated_at,
       question_categories(categories(id, name)),
       question_tags(tags(id, name)),
       question_edits(id, change_reason, created_at)`
    )
    .eq("id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false, referencedTable: "question_edits" })
    .single();

  // PGRST116 = PostgREST "no rows returned" for .single()
  if (error?.code === "PGRST116" || !row) throw new NotFoundError("Question not found.");
  if (error) throw error;

  interface RawRow {
    id: string;
    generated_type: GeneratedType;
    status: QuestionStatus;
    question_text: string;
    correct_answer: unknown;
    difficulty_score: number;
    image_path: string | null;
    source_model: string | null;
    created_at: string;
    updated_at: string;
    question_categories: { categories: CategoryRefDTO | null }[];
    question_tags: { tags: Pick<Tables<"tags">, "id" | "name"> | null }[];
    question_edits: QuestionEditHistoryDTO[];
  }

  const typedRow = row as unknown as RawRow;

  return {
    id: typedRow.id,
    generated_type: typedRow.generated_type,
    status: typedRow.status,
    question_text: typedRow.question_text,
    correct_answer: typedRow.correct_answer as CorrectAnswerDTO,
    difficulty_score: typedRow.difficulty_score,
    image_path: typedRow.image_path,
    source_model: typedRow.source_model,
    created_at: typedRow.created_at,
    updated_at: typedRow.updated_at,
    categories: typedRow.question_categories
      .map((qc) => qc.categories)
      .filter((c): c is CategoryRefDTO => c !== null),
    tags: typedRow.question_tags
      .map((qt) => qt.tags)
      .filter((t): t is Pick<Tables<"tags">, "id" | "name"> => t !== null),
    edit_history: typedRow.question_edits ?? [],
  };
}
```

---

### Krok 3 — Utwórz route `src/pages/api/questions/[id].ts`

```typescript
import type { APIRoute } from "astro";
import { z } from "zod";

import { NotFoundError } from "@/lib/errors";
import { getQuestionById } from "@/lib/services/questions.service";

export const prerender = false;

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const result = await getQuestionById(locals.supabase, locals.user.id, parsed.data.id);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[GET /api/questions/:id] Unexpected error", { userId: locals.user.id, id: parsed.data.id, err });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
```

---

### Krok 4 — Weryfikacja migracji (opcjonalna)

Sprawdź, czy istnieje indeks na `question_edits(question_id)`. Jeśli nie — dodaj migrację:

```sql
-- supabase/migrations/YYYYMMDDHHmmss_question_edits_question_id_idx.sql
create index if not exists question_edits_question_id_idx
  on question_edits (question_id);
```

---

### Krok 5 — Uruchom linter i sprawdź błędy TypeScript

```bash
npm run lint:fix
```
