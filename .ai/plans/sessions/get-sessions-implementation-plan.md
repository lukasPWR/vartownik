# API Endpoint Implementation Plan: GET /api/sessions

## 1. Przegląd punktu końcowego

`GET /api/sessions` zwraca paginowaną, opcjonalnie filtrowaną listę sesji quizowych należących do zalogowanego użytkownika. Endpoint jest konsumowany przez widok dashboardu (US-006) — widget **Recent Sessions** — i dostarcza zarówno metadane sesji, jak i obliczone podsumowanie wyników na podstawie powiązanych prób (`attempts`).

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/sessions`
- **Parametry:**
  - **Wymagane:** brak (uwierzytelnienie odbywa się przez cookie sesji)
  - **Opcjonalne (query params):**
    | Parametr | Typ | Wartość domyślna | Opis |
    |----------|-----|-----------------|------|
    | `page`   | integer ≥ 1 | `1` | Numer strony |
    | `limit`  | integer 1–100 | `10` | Liczba elementów na stronę |
    | `status` | `in_progress \| completed \| abandoned` | brak | Filtr statusu sesji |
- **Request Body:** brak

---

## 3. Wykorzystywane typy

Wszystkie typy pochodzą z `src/types.ts`.

```ts
// Wyliczenie statusu sesji (z database.types.ts)
type SessionStatus = "in_progress" | "completed" | "abandoned";

// Podsumowanie wyników — nullable dla sesji bez prób (in_progress / abandoned)
interface ScoreSummaryDTO {
  total_questions: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number;
}

// Element listy zwracany w tablicy data[]
interface SessionListItemDTO {
  id: string;
  status: SessionStatus;
  timer_seconds: number;
  total_rounds: number;
  questions_per_round: number;
  started_at: string;          // ISO 8601
  completed_at: string | null;
  score_summary: ScoreSummaryDTO | null;
}

// Standardowa koperta paginacji
interface PaginationDTO {
  page: number;
  limit: number;
  total: number;
}

// Envelope odpowiedzi 200
interface SessionsResponseDTO {
  data: SessionListItemDTO[];
  pagination: PaginationDTO;
}
```

### Schemat walidacji Zod (query params)

```ts
const QuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["in_progress", "completed", "abandoned"]).optional(),
});
```

---

## 4. Szczegóły odpowiedzi

### 200 OK

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

> `score_summary` wynosi `null` gdy sesja jest `in_progress` lub `abandoned` bez żadnych zarejestrowanych prób.

### Odpowiedzi błędów

| Status | Treść | Warunek wyzwalający |
|--------|-------|---------------------|
| `400`  | `{ "error": "Validation failed", "issues": [...] }` | Nieprawidłowe query params |
| `401`  | `{ "error": "Unauthorized" }` | Brak zalogowanego użytkownika |
| `500`  | `{ "error": "Internal server error" }` | Błąd Supabase lub wyjątek runtime |

---

## 5. Przepływ danych

```
Klient
  │  GET /api/sessions?page=1&limit=10&status=completed
  ▼
Middleware (src/middleware.ts)
  │  Odczyt cookie sesji → resolwuje locals.user
  │  (brak sesji → redirect do /auth/signin)
  ▼
Handler GET (src/pages/api/sessions/index.ts)
  │  Guard clause: !locals.user → 401
  │  Parsuj i waliduj query params przez QuerySchema
  │  (błąd walidacji → 400)
  ▼
SessionsService.listSessions(supabase, userId, query)
  │  (src/lib/services/sessions.service.ts)
  │  Buduje zapytanie Supabase:
  │    SELECT id, status, timer_seconds, total_rounds, questions_per_round,
  │           started_at, completed_at,
  │           rounds ( attempts ( verdict ) )
  │    FROM sessions
  │    WHERE user_id = $userId        -- + RLS jako drugorzędna ochrona
  │    [AND status = $status]
  │    ORDER BY started_at DESC
  │    LIMIT $limit OFFSET $offset
  │    COUNT = exact
  │
  │  Mapuje wiersze → SessionListItemDTO[]
  │    (spłaszcza attempts → oblicza ScoreSummaryDTO | null)
  │
  └─► Zwraca SessionsResponseDTO
  ▼
Handler
  │  Serializuje do JSON
  └─► Response 200 { data, pagination }
```

### Szczegóły obliczenia `ScoreSummaryDTO`

```
allAttempts = session.rounds.flatMap(r => r.attempts)
knew_count         = allAttempts.filter(a => a.verdict === "knew").length
did_not_know_count = allAttempts.filter(a => a.verdict === "did_not_know").length
scored             = knew_count + did_not_know_count
accuracy_percent   = scored > 0
                     ? round((knew_count / scored) * 1000) / 10   // 1 miejsce dziesiętne
                     : 0
score_summary = total_questions > 0 ? { ... } : null
```

---

## 6. Względy bezpieczeństwa

- **Uwierzytelnienie:** Middleware gwarantuje zalogowanie przed dotarciem żądania do handlera; handler dodaje guard clause jako drugą warstwę ochrony (defense in depth).
- **Autoryzacja:** Zapytanie zawsze filtruje `user_id = locals.user.id`. Polityki RLS na tabeli `sessions` wymuszają to samo na poziomie bazy danych — cross-user data leak jest niemożliwy nawet przy błędzie w kodzie aplikacji.
- **Walidacja wejścia:** Zod odrzuca nieznane klucze, wymusza typy i zakres wartości. `status` musi być jedną z trzech literałów enum.
- **SQL injection:** Klient Supabase używa zapytań sparametryzowanych — brak konkatenacji surowego SQL.
- **Ekspozycja danych:** Odpowiedzi błędów 5xx nie zawierają szczegółów wewnętrznych (stack trace, komunikaty Supabase). Szczegóły błędów trafiają tylko do `console.error` po stronie serwera.
- **Klient Supabase:** Wyłącznie `locals.supabase` (scoped do cookie użytkownika, SSR-safe) — nigdy klucz service role ani bezpośredni import `supabaseClient` w pliku route.

---

## 7. Obsługa błędów

| Scenariusz | Status | Akcja |
|------------|--------|-------|
| Brak `locals.user` | `401` | Early return z `{ error: "Unauthorized" }` |
| Nieprawidłowe query params | `400` | Zwróć `{ error: "Validation failed", issues: ZodIssue[] }` |
| Błąd zapytania Supabase (`error` !== null) | `500` | `throw error` → złapany w catch → log + 500 |
| Niespodziewany wyjątek runtime | `500` | `catch (err)` → `console.error` + 500 |

Blok `try/catch` opakowuje wyłącznie logikę serwisu (wywołanie Supabase i mapowanie); walidacja query params jest poza nim.

---

## 8. Rozważania dotyczące wydajności

- **Indeksy DB:** Tabela `sessions` wymaga:
  - indeksu złożonego `(user_id, started_at DESC)` — obsługuje stronicowaną, posortowaną listę sesji użytkownika,
  - indeksu `(user_id, status)` — przyspiesza filtrowanie po statusie.
- **Join zamiast N+1:** Jedno zapytanie ze zagnieżdżonym `rounds(attempts(verdict))` pobiera wszystko naraz — brak N+1 queries.
- **Ograniczenie `limit`:** Cap 100 elementów na stronę ogranicza rozmiar odpowiedzi przy szerokim joinie.
- **`count: "exact"`:** Dodaje `COUNT(*)` do każdego zapytania. Gdy klient cachuje `total` z pierwszej strony, kolejne żądania mogą pomijać count (opcjonalne usprawnienie w przyszłości).
- **Paginacja offset:** Prosta i wystarczająca dla dashboard use-case (nieduże zbiory, niedawne sesje). Przy bardzo dużych zbiorach rozważyć cursor-based pagination.

---

## 9. Etapy wdrożenia

1. **Utwórz plik route** `src/pages/api/sessions/index.ts` z `export const prerender = false`.

2. **Zdefiniuj schemat Zod** (`QuerySchema`) dla `page`, `limit`, `status` — z koercją typów i wartościami domyślnymi.

3. **Utwórz serwis** `src/lib/services/sessions.service.ts`:
   - Eksportuj funkcję `listSessions(supabase: SupabaseClientType, userId: string, query: ListSessionsQuery): Promise<SessionsResponseDTO>`.
   - Zbuduj zapytanie Supabase: `select` z zagnieżdżonym `rounds(attempts(verdict))`, `count: "exact"`, filtr `user_id`, sortowanie `started_at DESC`, `range`.
   - Opcjonalnie dołącz filtr `status` gdy przekazany.
   - Zmapuj każdy wiersz → `SessionListItemDTO` (spłaszcz attempts, oblicz `ScoreSummaryDTO | null`).
   - Rzuć błąd Supabase bez owijania — handler obsłuży go w catch.

4. **Zaimplementuj handler `GET`** w pliku route:
   - Guard clause: `!locals.user → 401`.
   - Parsuj `searchParams` → `QuerySchema.safeParse` → `400` przy błędzie.
   - Wywołaj `listSessions(locals.supabase, locals.user.id, parsed.data)` w bloku `try/catch`.
   - Zwróć `Response` z JSON i `Content-Type: application/json`.
   - W `catch`: `console.error("[GET /api/sessions]", err)` → 500.

5. **Sprawdź migracje DB** — upewnij się, że istnieją indeksy:
   - `CREATE INDEX IF NOT EXISTS sessions_user_started_at_idx ON sessions (user_id, started_at DESC);`
   - `CREATE INDEX IF NOT EXISTS sessions_user_status_idx ON sessions (user_id, status);`
   - Jeśli brakuje, utwórz migrację `supabase/migrations/YYYYMMDDHHmmss_sessions_list_indexes.sql`.

6. **Zweryfikuj polityki RLS** na tabeli `sessions` — upewnij się, że istnieje polityka `SELECT` ograniczona do `auth.uid() = user_id`.

7. **Przetestuj endpoint ręcznie** dla scenariuszy:
   - Brak uwierzytelnienia → 401.
   - Nieprawidłowe `page=abc` → 400.
   - Prawidłowe żądanie bez filtra → 200 z paginacją.
   - Prawidłowe żądanie z `status=completed` → 200 z przefiltrowanymi wynikami.
   - Brak sesji dla użytkownika → 200 z pustą tablicą `data`.
