# API Endpoint Implementation Plan: PATCH /api/sessions/:id

## 1. Przegląd punktu końcowego

Endpoint umożliwia jawne porzucenie aktywnej sesji treningowej (np. gdy użytkownik opuści widok gry). Jedyną obsługiwaną zmianą statusu jest przejście `in_progress` → `abandoned`. Po aktualizacji endpoint ustawia pole `abandoned_at` na bieżący czas UTC i zwraca pełny, zaktualizowany obiekt sesji.

## 2. Szczegóły żądania

- **Metoda HTTP:** `PATCH`
- **Struktura URL:** `/api/sessions/:id`
- **Parametry:**
  - Wymagane (path): `id` — UUID istniejącej sesji
  - Opcjonalne: brak
- **Request Body (JSON):**

```json
{ "status": "abandoned" }
```

## 3. Wykorzystywane typy

Wszystkie poniższe typy **istnieją już** w `src/types.ts` — nie trzeba ich dodawać.

```ts
// Command model — walidowane body żądania
interface UpdateSessionCommand {
  status: "abandoned";
}

// Alias enuma statusu
type SessionStatus = Enums<"session_status_enum">; // "in_progress" | "completed" | "abandoned"

// Pełny DTO sesji — body odpowiedzi 200
interface SessionDetailDTO extends Omit<SessionDTO, "score_summary"> {
  generation_batch_id: string | null;
  abandoned_at: string | null;
  score_summary: ScoreSummaryDTO;
  rounds: RoundSummaryDTO[];
}
```

## 4. Szczegóły odpowiedzi

| Status | Opis | Body |
|--------|------|------|
| `200 OK` | Sesja porzucona pomyślnie | `SessionDetailDTO` |
| `400 Bad Request` | Nieprawidłowe body lub niedozwolone przejście statusu | `{ error: string, issues?: ValidationIssue[] }` |
| `401 Unauthorized` | Użytkownik niezalogowany | `{ error: "Unauthorized" }` |
| `404 Not Found` | Sesja nie istnieje lub należy do innego użytkownika | `{ error: "Session not found" }` |
| `500 Internal Server Error` | Błąd po stronie serwera (Supabase) | `{ error: "Internal server error" }` |

**Przykładowe body odpowiedzi 200:**

```json
{
  "id": "uuid",
  "status": "abandoned",
  "generation_batch_id": "uuid",
  "timer_seconds": 20,
  "total_rounds": 4,
  "questions_per_round": 10,
  "started_at": "2026-05-10T10:00:00Z",
  "completed_at": null,
  "abandoned_at": "2026-05-10T10:15:00Z",
  "score_summary": {
    "total_questions": 10,
    "knew_count": 7,
    "did_not_know_count": 3,
    "accuracy_percent": 70.0
  },
  "rounds": [
    { "id": "uuid", "position": 1, "status": "completed" },
    { "id": "uuid", "position": 2, "status": "in_progress" }
  ]
}
```

## 5. Przepływ danych

```
PATCH /api/sessions/:id
  │
  ├─ 1. Middleware — wstrzykuje locals.user (null jeśli niezalogowany)
  │
  ├─ 2. API Route (src/pages/api/sessions/[id].ts)
  │     ├─ Sprawdź locals.user → 401 jeśli brak
  │     ├─ Zod: walidacja path param `id` (UUID)
  │     ├─ Zod: walidacja body { status: "abandoned" }
  │     └─ Wywołaj sessions.service.ts → abandonSession(supabase, id, userId)
  │
  └─ 3. sessions.service.ts — abandonSession()
        ├─ SELECT sesji po id i user_id → 404 jeśli brak wyników
        ├─ Sprawdź session.status === "in_progress" → 400 jeśli inny status
        ├─ UPDATE sessions SET status = "abandoned", abandoned_at = now() WHERE id = :id
        ├─ SELECT pełnego SessionDetailDTO (z rundami i wynikami)
        └─ Zwróć SessionDetailDTO do route handler → 200
```

## 6. Względy bezpieczeństwa

- **Autoryzacja:** Endpoint wymaga zalogowanego użytkownika (`locals.user`). Jeśli `!locals.user`, natychmiast zwróć `401`.
- **IDOR (Insecure Direct Object Reference):** Pobieranie sesji zawsze filtruje po `user_id = locals.user.id`. Nie wystawiaj informacji o istnieniu sesji należącej do innego użytkownika — zwracaj `404` zamiast `403`.
- **RLS Supabase:** Polityki Row Level Security na tabeli `sessions` zapewniają drugi poziom ochrony — query automatycznie zwróci pusty wynik dla nie-właściciela.
- **Walidacja wejścia:** Schemat Zod `z.literal("abandoned")` odrzuca wszelkie inne wartości pola `status`, uniemożliwiając np. bezpośrednie przestawienie sesji na `completed` przez API.
- **Walidacja UUID:** Path param `id` walidowany Zodem (`z.string().uuid()`), co zapobiega SQL injection przez malformed input.

## 7. Obsługa błędów

| Scenariusz | Kod | Odpowiedź |
|------------|-----|-----------|
| `locals.user` jest `null` | `401` | `{ "error": "Unauthorized" }` |
| Path param `id` nie jest UUID | `400` | `{ "error": "Validation failed", "issues": [...] }` |
| Body nie zawiera `status: "abandoned"` | `400` | `{ "error": "Validation failed", "issues": [...] }` |
| Sesja nie istnieje lub należy do innego użytkownika | `404` | `{ "error": "Session not found" }` |
| Sesja ma status inny niż `in_progress` | `400` | `{ "error": "Only in_progress sessions can be abandoned" }` |
| Błąd Supabase podczas UPDATE | `500` | `{ "error": "Internal server error" }` |

W serwisie używamy rzucania własnych klas błędów (`NotFoundError`, `BadRequestError` zdefiniowanych w `src/lib/errors.ts`), które route handler przechwytuje i mapuje na odpowiednie kody HTTP.

## 8. Rozważania dotyczące wydajności

- Operacja wykonuje 2 zapytania do bazy: SELECT (weryfikacja właściciela i statusu) + UPDATE + SELECT zwrotny. Dla pojedynczego wiersza narzut jest pomijalny.
- Kolumna `sessions.id` jest kluczem głównym (indeks btree) — wyszukiwanie po `id` i `user_id` jest O(log n).
- Nie stosujemy transakcji jawnych (operacja jest idempotentna w sensie biznesowym — ponowne PATCH zwróci 400, bo status już nie jest `in_progress`).
- Można rozważyć `UPDATE ... RETURNING *` zamiast osobnego SELECT zwrotnego, ale join na `rounds` i obliczenie `score_summary` wymaga dodatkowego zapytania.

## 9. Etapy wdrożenia

1. **Utwórz `src/lib/errors.ts` (jeśli `BadRequestError` jeszcze nie istnieje)** — dodaj klasę `BadRequestError extends Error` analogicznie do istniejących klas błędów w `src/lib/errors.ts`.

2. **Utwórz `src/lib/services/sessions.service.ts`** — plik serwisu z funkcją `abandonSession`:
   ```ts
   export async function abandonSession(
     supabase: SupabaseClientType,
     sessionId: string,
     userId: string
   ): Promise<SessionDetailDTO>
   ```
   - SELECT sesji (`id`, `status`, `user_id`) WHERE `id = sessionId AND user_id = userId` → rzuć `NotFoundError` jeśli brak.
   - Sprawdź `session.status === "in_progress"` → rzuć `BadRequestError` jeśli inny.
   - `UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE id = sessionId` → sprawdź error Supabase.
   - SELECT pełnego SessionDetailDTO (sesja + rundy z `rounds(id, position, status)` + attempts do score_summary).
   - Zmapuj wynik na `SessionDetailDTO` i zwróć.

3. **Utwórz `src/pages/api/sessions/[id].ts`** — plik route handler (może już zawierać `GET` dla `get-session-by-id`; dodaj eksport `PATCH`):
   ```ts
   export const prerender = false;
   export const PATCH: APIRoute = async ({ locals, params, request }) => { ... }
   ```
   - Guard `!locals.user` → zwróć `401`.
   - Zod walidacja `params.id` jako UUID.
   - Zod walidacja `await request.json()` jako `{ status: z.literal("abandoned") }`.
   - Wywołaj `abandonSession(locals.supabase, id, locals.user.id)`.
   - Catch blok: mapuj `NotFoundError` → 404, `BadRequestError` → 400, pozostałe → 500.
   - Zwróć `200` z JSON `SessionDetailDTO`.

4. **Dodaj Zod schematy w route handler:**
   ```ts
   const ParamsSchema = z.object({ id: z.string().uuid() });
   const BodySchema = z.object({ status: z.literal("abandoned") });
   ```

5. **Zweryfikuj typy** — upewnij się, że `SessionDetailDTO`, `UpdateSessionCommand`, `SessionStatus` i `RoundSummaryDTO` są importowane z `@/types`.

6. **Uruchom linter** (`npm run lint`) i napraw wszelkie zgłoszenia ESLint.

7. **Manualne testy smoke:**
   - PATCH z prawidłowym body na istniejącej `in_progress` sesji → oczekiwany status 200.
   - PATCH bez tokenu → 401.
   - PATCH na nieistniejące `id` → 404.
   - PATCH z `status: "completed"` → 400 (walidacja Zod).
   - PATCH na sesji ze statusem `completed` lub `abandoned` → 400 (logika serwisu).
