# API Endpoint Implementation Plan: GET /api/questions

## 1. Przegląd punktu końcowego

Endpoint zwraca paginowaną, filtrowalną i sortowalną listę pytań należących do uwierzytelnionego użytkownika. Każde pytanie zawiera zagnieżdżone odwołania do kategorii i tagów. Dane pobierane są z tabel `questions`, `question_categories`, `categories`, `question_tags` i `tags` z obowiązkowym filtrowaniem po `user_id`.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/questions`
- **Request Body:** brak

### Parametry

**Wymagane (niejawne):**
- sesja użytkownika — cookie Supabase SSR (dostarczana automatycznie przez middleware)

**Opcjonalne (query string):**

| Parametr         | Typ      | Wartość domyślna    | Opis |
|------------------|----------|---------------------|------|
| `page`           | integer  | `1`                 | Numer strony (≥ 1) |
| `limit`          | integer  | `20`                | Rozmiar strony (1–100) |
| `status`         | enum     | —                   | `active \| flagged \| needs_review \| verified \| archived` |
| `generated_type` | enum     | —                   | `manual \| ai` |
| `category_id`    | UUID     | —                   | Filtr po kategorii |
| `tag_id`         | UUID     | —                   | Filtr po tagu |
| `difficulty_score` | integer | —                  | Filtr trudności (1–5) |
| `q`              | string   | —                   | Pełnotekstowe wyszukiwanie (max 200 znaków) |
| `sort`           | enum     | `created_at_desc`   | `created_at_desc \| created_at_asc \| difficulty_asc \| difficulty_desc` |

---

## 3. Wykorzystywane typy

Wszystkie typy są już zdefiniowane w `src/types.ts`. Nie jest wymagane tworzenie nowych.

```typescript
// Typy odpowiedzi
import type {
  ListQuestionsResponseDTO, // { data: QuestionDTO[], pagination: PaginationDTO }
  QuestionDTO,              // pojedyncze pytanie z embeds
  PaginationDTO,            // { page, limit, total }
  CategoryRefDTO,           // { id, name }
  QuestionStatus,           // 'active' | 'flagged' | 'needs_review' | 'verified' | 'archived'
  GeneratedType,            // 'manual' | 'ai'
} from "@/types";
```

Lokalny, Zod-inferred typ parametrów zapytania (`ListQuestionsQuery`) definiowany wewnątrz serwisu — nie wymaga eksportu do `types.ts`.

---

## 4. Szczegóły odpowiedzi

### 200 OK

```json
{
  "data": [
    {
      "id": "uuid",
      "generated_type": "ai",
      "status": "active",
      "question_text": "Który piłkarz...",
      "correct_answer": { "primary": "Robert Lewandowski", "synonyms": ["RL9"] },
      "difficulty_score": 4,
      "image_path": null,
      "source_model": "gpt-4o",
      "categories": [{ "id": "uuid", "name": "Ekstraklasa" }],
      "tags": [{ "id": "uuid", "name": "finals" }],
      "created_at": "2026-03-21T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 312 }
}
```

### Kody statusu

| Kod | Sytuacja |
|-----|----------|
| 200 | Sukces — lista pytań (może być pusta) |
| 400 | Nieprawidłowe parametry zapytania (błąd Zod) |
| 401 | Brak lub nieważna sesja użytkownika |
| 500 | Błąd po stronie serwera (błąd Supabase) |

---

## 5. Przepływ danych

```
HTTP GET /api/questions?...
  │
  ▼
[src/pages/api/questions/index.ts]  ← Astro API route
  1. Sprawdź locals.user → 401 jeśli brak
  2. Pobierz supabase z locals (SSR client z cookie)
  3. Parsuj i waliduj query string → Zod → 400 przy błędach
  4. Wywołaj listQuestions(supabase, user.id, params)
  │
  ▼
[src/lib/services/questions.service.ts]
  5. Zbuduj zapytanie Supabase z zagnieżdżonym selectem:
       questions + question_categories(categories) + question_tags(tags)
  6. Filtruj: .eq("user_id", userId) — zawsze
  7. Opcjonalne filtry: status, generated_type, category_id, tag_id, difficulty_score
  8. Pełnotekstowe wyszukiwanie: .textSearch("search_vector", q) jeśli q podane
  9. Sortowanie: .order(column, { ascending })
  10. Paginacja: .range(offset, offset + limit - 1) + { count: "exact" }
  11. Zmapuj wynik na QuestionDTO[] (rozwiń question_categories/question_tags)
  12. Zwróć ListQuestionsResponseDTO
  │
  ▼
[src/pages/api/questions/index.ts]
  13. Zwróć Response 200 z JSON
```

### Struktura zapytania Supabase

```typescript
const { data, count, error } = await supabase
  .from("questions")
  .select(
    `id, generated_type, status, question_text, correct_answer,
     difficulty_score, image_path, source_model, created_at,
     question_categories(
       categories(id, name)
     ),
     question_tags(
       tags(id, name)
     )`,
    { count: "exact" }
  )
  .eq("user_id", userId)
  // + opcjonalne .eq(), .textSearch(), .order(), .range()
```

### Filtr category_id

Filtrowanie przez tabelę pośrednią wymaga użycia `!inner` join:

```typescript
// Jeśli params.category_id jest podane, modyfikuj select:
.select(`..., question_categories!inner(category_id, categories(id, name))`)
.eq("question_categories.category_id", params.category_id)
```

### Filtr tag_id — analogicznie:

```typescript
.select(`..., question_tags!inner(tag_id, tags(id, name))`)
.eq("question_tags.tag_id", params.tag_id)
```

> **Uwaga:** gdy oba filtry są aktywne jednocześnie, należy oba `!inner` join połączyć w jednym `.select()`.

### Mapowanie wyników

Supabase zwraca relacje jako zagnieżdżone tablice. Wymagane przemapowanie:

```typescript
const mapped: QuestionDTO[] = (data ?? []).map((row) => ({
  id: row.id,
  generated_type: row.generated_type,
  status: row.status,
  question_text: row.question_text,
  correct_answer: row.correct_answer as CorrectAnswerDTO,
  difficulty_score: row.difficulty_score,
  image_path: row.image_path,
  source_model: row.source_model,
  created_at: row.created_at,
  categories: row.question_categories
    .map((qc) => qc.categories)
    .filter(Boolean) as CategoryRefDTO[],
  tags: row.question_tags
    .map((qt) => qt.tags)
    .filter(Boolean) as Pick<Tables<"tags">, "id" | "name">[],
}));
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnianie:** Guard `if (!locals.user)` jako pierwszy krok handlera — 401 przed jakimkolwiek dostępem do DB.

2. **Izolacja danych użytkownika:** Każde zapytanie Supabase zawiera `.eq("user_id", user.id)`. Supabase RLS stanowi drugą warstwę ochrony (polityki `SELECT` na tabelach `questions`, `categories`, `tags`).

3. **Walidacja wejść:**
   - `page`, `limit` — `z.coerce.number().int()` z zakresami
   - `status`, `generated_type`, `sort` — `z.enum([...])`, tylko dozwolone wartości
   - `category_id`, `tag_id` — `z.string().uuid()`, walidacja formatu UUID zapobiega injekcji
   - `q` — `z.string().max(200).optional()`, limit długości zapobiega nadmiernemu obciążeniu indeksu `search_vector`
   - `difficulty_score` — `z.coerce.number().int().min(1).max(5)`

4. **Brak wycieku danych:** Endpoint nie zwraca pól wewnętrznych (`user_id`, `content_hash`, `schema_version`, `generation_metadata`, `search_vector`, `last_verified_at`).

5. **Parametryzowane zapytania:** Supabase SDK używa prepared statements — brak ryzyka SQL injection.

---

## 7. Obsługa błędów

| Sytuacja | Kod | Response body |
|----------|-----|---------------|
| Brak sesji / `locals.user === null` | 401 | `{ "error": "Unauthorized" }` |
| Błąd walidacji Zod | 400 | `{ "error": "Validation failed", "issues": [...] }` |
| Błąd Supabase (np. timeout, brak połączenia) | 500 | `{ "error": "Internal server error" }` |

Błędy 500 logowane przez `console.error` z kontekstem: `{ userId, params, supabaseError }`.

---

## 8. Rozważania dotyczące wydajności

1. **Indeks `search_vector`:** Kolumna `search_vector` w tabeli `questions` powinna mieć indeks GIN, aby `textSearch()` pracował efektywnie. Upewnij się, że migracja go zawiera.

2. **Paginacja na poziomie DB:** Używamy `.range()` zamiast pobierania wszystkich rekordów i przycinania w pamięci.

3. **Count:** `{ count: "exact" }` wykonuje `COUNT(*)` w jednym zapytaniu (jeden round-trip do DB).

4. **Limit maksymalny:** `limit` ≤ 100 — zapobiega przepędzaniu pamięci przy dużym zbiorze.

5. **Join filtryczny `!inner`:** Użycie `!inner` join przy filtrach `category_id`/`tag_id` jest efektywniejsze niż pobieranie wszystkich pytań i filtrowanie w JS.

6. **Indeksy sugerowane:**
   - `questions(user_id, created_at DESC)` — dla domyślnego sortowania
   - `questions(user_id, difficulty_score)` — dla sortowania po trudności
   - `questions(user_id, status)` — dla filtru status
   - `question_categories(category_id, question_id)` — dla filtru category_id
   - `question_tags(tag_id, question_id)` — dla filtru tag_id

---

## 9. Etapy implementacji

### Krok 1 — Zod schema dla parametrów w route

Utwórz plik `src/pages/api/questions/index.ts` z Zod schema dla query params:

```typescript
const ListQuestionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["active", "flagged", "needs_review", "verified", "archived"]).optional(),
  generated_type: z.enum(["manual", "ai"]).optional(),
  category_id: z.string().uuid().optional(),
  tag_id: z.string().uuid().optional(),
  difficulty_score: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["created_at_desc", "created_at_asc", "difficulty_asc", "difficulty_desc"])
        .default("created_at_desc"),
});

export type ListQuestionsQuery = z.infer<typeof ListQuestionsSchema>;
```

### Krok 2 — Handler GET w route

W tym samym pliku (`index.ts`) eksportuj `GET: APIRoute`:

```typescript
export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = ListQuestionsSchema.safeParse(rawParams);

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
    const result = await listQuestions(locals.supabase, locals.user.id, parsed.data);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[GET /api/questions] DB error", { userId: locals.user.id, err });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
```

### Krok 3 — Serwis `src/lib/services/questions.service.ts`

Utwórz nowy plik serwisu. Struktura funkcji `listQuestions`:

```typescript
import type { SupabaseClientType } from "@/db/supabase.client";
import type { ListQuestionsResponseDTO, QuestionDTO, CorrectAnswerDTO, CategoryRefDTO } from "@/types";
import type { ListQuestionsQuery } from "@/pages/api/questions/index"; // lub zdefiniuj typ lokalnie

export async function listQuestions(
  supabase: SupabaseClientType,
  userId: string,
  params: ListQuestionsQuery
): Promise<ListQuestionsResponseDTO> {
  const { page, limit, status, generated_type, category_id, tag_id, difficulty_score, q, sort } = params;
  const offset = (page - 1) * limit;

  // Buduj select z opcjonalnymi !inner joinami
  let selectClause = `
    id, generated_type, status, question_text, correct_answer,
    difficulty_score, image_path, source_model, created_at,
    question_categories${category_id ? "!inner" : ""}(
      category_id,
      categories(id, name)
    ),
    question_tags${tag_id ? "!inner" : ""}(
      tag_id,
      tags(id, name)
    )
  `;

  let query = supabase
    .from("questions")
    .select(selectClause, { count: "exact" })
    .eq("user_id", userId);

  // Opcjonalne filtry
  if (status)           query = query.eq("status", status);
  if (generated_type)   query = query.eq("generated_type", generated_type);
  if (difficulty_score) query = query.eq("difficulty_score", difficulty_score);
  if (category_id)      query = query.eq("question_categories.category_id", category_id);
  if (tag_id)           query = query.eq("question_tags.tag_id", tag_id);
  if (q)                query = query.textSearch("search_vector", q, { type: "websearch" });

  // Sortowanie
  const sortMap: Record<string, { column: string; ascending: boolean }> = {
    created_at_desc: { column: "created_at", ascending: false },
    created_at_asc:  { column: "created_at", ascending: true },
    difficulty_asc:  { column: "difficulty_score", ascending: true },
    difficulty_desc: { column: "difficulty_score", ascending: false },
  };
  const { column, ascending } = sortMap[sort];
  query = query.order(column, { ascending });

  // Paginacja
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) throw error;

  const mapped: QuestionDTO[] = (data ?? []).map((row) => ({
    id: row.id,
    generated_type: row.generated_type,
    status: row.status,
    question_text: row.question_text,
    correct_answer: row.correct_answer as CorrectAnswerDTO,
    difficulty_score: row.difficulty_score,
    image_path: row.image_path,
    source_model: row.source_model,
    created_at: row.created_at,
    categories: (row.question_categories ?? [])
      .map((qc: { categories: CategoryRefDTO | null }) => qc.categories)
      .filter((c): c is CategoryRefDTO => c !== null),
    tags: (row.question_tags ?? [])
      .map((qt: { tags: { id: string; name: string } | null }) => qt.tags)
      .filter((t): t is { id: string; name: string } => t !== null),
  }));

  return {
    data: mapped,
    pagination: { page, limit, total: count ?? 0 },
  };
}
```

### Krok 4 — Weryfikacja `locals.supabase` w middleware

Upewnij się, że middleware (`src/middleware.ts`) przypisuje do `locals.supabase` klienta SSR (z cookie), a nie statycznego `supabaseClient`:

```typescript
// src/middleware.ts — poprawne przypisanie
const supabase = createClient(request.headers, cookies);
context.locals.supabase = supabase;
```

> Aktualnie middleware przypisuje `supabaseClient` (globalny) do `locals.supabase` — dla endpointów wymagających sesji użytkownika należy użyć klienta SSR.

### Krok 5 — Aktualizacja typów `src/env.d.ts`

Upewnij się, że `locals.supabase` jest poprawnie otypowany:

```typescript
// src/env.d.ts
import type { SupabaseClientType } from "@/db/supabase.client";
import type { User } from "@supabase/supabase-js";

declare namespace App {
  interface Locals {
    supabase: SupabaseClientType;
    user: User | null;
  }
}
```

### Krok 6 — Testy manualne

Przetestuj następujące scenariusze:

| Scenariusz | Oczekiwany wynik |
|---|---|
| Brak cookies (niezalogowany) | 401 |
| Zapytanie bez parametrów | 200, domyślna strona 1, limit 20 |
| `?status=active&page=2&limit=5` | 200, poprawna paginacja |
| `?sort=difficulty_asc` | 200, sortowanie rosnące po trudności |
| `?category_id=invalid-uuid` | 400, błąd walidacji UUID |
| `?limit=101` | 400, limit przekroczony |
| `?q=Lewandowski` | 200, filtr pełnotekstowy |
| `?category_id=<uuid>` | 200, tylko pytania z daną kategorią |
| `?generated_type=ai&status=flagged` | 200, podwójny filtr |
