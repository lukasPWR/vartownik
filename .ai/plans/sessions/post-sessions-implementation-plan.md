# API Endpoint Implementation Plan: POST /api/sessions

## 1. Przegląd punktu końcowego

Endpoint tworzy nową sesję treningową powiązaną z ukończoną (status `success`) partią generowania pytań. Po wstawieniu sesji baza danych automatycznie (trigger) ustawia wszelkie istniejące sesje użytkownika o statusie `in_progress` na `abandoned`. Serwer zwraca nowo utworzoną sesję wraz z pełną listą 4 rund.

## 2. Szczegóły żądania

- **Metoda HTTP:** `POST`
- **Struktura URL:** `/api/sessions`
- **Parametry:**
  - Wymagane: brak parametrów URL / query
  - Opcjonalne: brak parametrów URL / query
- **Request Body (JSON):**

```json
{
  "generation_batch_id": "uuid",    // wymagane
  "timer_seconds": 20               // opcjonalne, zakres [15, 30], domyślnie 20
}
```

## 3. Wykorzystywane typy

Wszystkie typy istnieją już w `src/types.ts` — nie trzeba ich dodawać.

```ts
// Command model — body żądania
interface CreateSessionCommand {
  generation_batch_id: string;
  timer_seconds?: number;           // default: 20
}

// Slim DTO rundy — element tablicy w odpowiedzi
type RoundSummaryDTO = Pick<Tables<"rounds">, "id" | "position" | "status">;

// Response DTO — body odpowiedzi 201
interface SessionCreatedDTO {
  id: string;
  status: SessionStatus;            // "in_progress"
  generation_batch_id: string | null;
  timer_seconds: number;
  total_rounds: number;             // 4
  questions_per_round: number;      // 10
  started_at: string;
  rounds: RoundSummaryDTO[];        // 4 elementy
}
```

## 4. Szczegóły odpowiedzi

| Status | Opis |
|--------|------|
| `201 Created` | Sesja pomyślnie utworzona |
| `400 Bad Request` | `timer_seconds` poza zakresem [15, 30] lub błąd walidacji Zod |
| `401 Unauthorized` | Użytkownik niezalogowany |
| `404 Not Found` | Partia nie istnieje lub należy do innego użytkownika |
| `422 Unprocessable Entity` | Partia istnieje, ale jej `status` ≠ `"success"` |
| `500 Internal Server Error` | Nieoczekiwany błąd po stronie serwera |

**Body odpowiedzi 201:**

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

## 5. Przepływ danych

```
Request
  │
  ▼
[API route] src/pages/api/sessions/index.ts (POST handler)
  │  1. Sprawdź locals.user → 401 jeśli brak
  │  2. Sparsuj i zwaliduj body za pomocą Zod
  │     - generation_batch_id: z.string().uuid()
  │     - timer_seconds: z.number().int().min(15).max(30).default(20)
  │  3. Przekaż do serwisu
  ▼
[Service] src/lib/services/sessions.service.ts → createSession()
  │  4. Pobierz generation_batch z Supabase:
  │        SELECT id, status FROM generation_batches
  │        WHERE id = :id AND user_id = :userId
  │     → 404 jeśli brak wyników
  │     → 422 jeśli batch.status !== "success"
  │  5. Wstaw nową sesję:
  │        INSERT INTO sessions (user_id, generation_batch_id, timer_seconds, status)
  │        VALUES (:userId, :batchId, :timerSeconds, 'in_progress')
  │        RETURNING id, status, generation_batch_id, timer_seconds,
  │                  total_rounds, questions_per_round, started_at
  │     (DB trigger automatycznie ustawia stare in_progress → abandoned)
  │  6. Pobierz rundy nowej sesji:
  │        SELECT id, position, status FROM rounds
  │        WHERE session_id = :sessionId
  │        ORDER BY position ASC
  │  7. Złóż i zwróć SessionCreatedDTO
  ▼
[API route] — zwróć Response 201 z JSON
```

> **Uwaga o triggerie:** Trigger bazodanowy `set_previous_sessions_abandoned` (lub analogiczny) uruchamia się automatycznie na `BEFORE INSERT ON sessions` i ustawia wszystkie istniejące sesje użytkownika o statusie `in_progress` na `abandoned`. Endpoint nie musi obsługiwać tej logiki ręcznie.

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie:** Każde żądanie musi posiadać zalogowanego użytkownika (`locals.user`). W przeciwnym razie zwracamy `401` natychmiast, przed jakimkolwiek dostępem do bazy.

2. **Autoryzacja / IDOR:** Partia generowania jest pobierana z filtrem `AND user_id = :userId`. Dzięki temu użytkownik nie może skorzystać z `generation_batch_id` należącego do kogoś innego — dostanie `404`, nie `403` (nie ujawniamy istnienia zasobu).

3. **Walidacja wejścia:** Każde pole body jest walidowane przez Zod przed trafieniem do serwisu. Nieprawidłowe UUID lub `timer_seconds` poza zakresem skutkują natychmiastowym `400`.

4. **RLS Supabase:** Tabele `sessions`, `rounds` i `generation_batches` muszą mieć polityki RLS ograniczające operacje do `user_id = auth.uid()`. Walidacja w serwisie stanowi dodatkową warstwę obrony.

5. **Brak wrażliwych danych w odpowiedzi:** `SessionCreatedDTO` nie zawiera pól wewnętrznych (np. `user_id`, `abandoned_at`).

## 7. Obsługa błędów

| Sytuacja | Status | Komunikat |
|----------|--------|-----------|
| Brak zalogowanego użytkownika | `401` | `"Unauthorized"` |
| Błąd walidacji Zod (np. zły UUID, `timer_seconds` poza zakresem) | `400` | `"Validation failed"` + `issues[]` |
| Batch nie istnieje / należy do innego usera | `404` | `"Generation batch not found"` |
| Batch istnieje, ale `status !== "success"` | `422` | `"Generation batch is not completed successfully"` |
| Nieoczekiwany błąd DB podczas inserta sesji | `500` | `"Internal server error"` |
| Nieoczekiwany błąd DB podczas pobierania rund | `500` | `"Internal server error"` |

Błędy `500` powinny być logowane przez `console.error` z kontekstem (userId, batchId) przed zwróceniem odpowiedzi.

## 8. Rozważania dotyczące wydajności

- **Liczba zapytań DB:** 3 zapytania — pobranie batcha, insert sesji, pobranie rund. Można zredukować do 2 używając podzapytania lub funkcji PostgreSQL, ale 3 zapytania przy małym rozmiarze danych są akceptowalne.
- **Indeksy:** Tabela `generation_batches` powinna mieć indeks na `(id, user_id)` dla szybkiego lookup. Tabela `rounds` powinna mieć indeks na `session_id`.
- **Transakcyjność:** Insert sesji i ewentualne wywołanie triggera dzieje się w jednej transakcji po stronie Supabase/PostgreSQL — brak potrzeby ręcznego zarządzania transakcją w kodzie aplikacji.

## 9. Etapy wdrożenia

1. **Utwórz `src/lib/services/sessions.service.ts`**
   - Dodaj funkcję `createSession(command: CreateSessionCommand, userId: string, supabase: SupabaseClientType): Promise<SessionCreatedDTO>`
   - Krok 1: Pobierz batch — `supabase.from("generation_batches").select("id, status").eq("id", batchId).eq("user_id", userId).single()`
   - Krok 2: Walidacja statusu batcha — rzuć dedykowany błąd jeśli `status !== "success"`
   - Krok 3: Wstaw sesję — `supabase.from("sessions").insert({...}).select("id, status, generation_batch_id, timer_seconds, total_rounds, questions_per_round, started_at").single()`
   - Krok 4: Pobierz rundy — `supabase.from("rounds").select("id, position, status").eq("session_id", sessionId).order("position")`
   - Krok 5: Złóż i zwróć `SessionCreatedDTO`

2. **Zdefiniuj Zod schema walidacji w pliku API route**

   ```ts
   const CreateSessionSchema = z.object({
     generation_batch_id: z.string().uuid(),
     timer_seconds: z.number().int().min(15).max(30).default(20),
   });
   ```

3. **Dodaj handler `POST` do `src/pages/api/sessions/index.ts`**
   - Sprawdź `locals.user` → `401`
   - Parsuj body jako JSON i waliduj przez Zod → `400` przy błędzie
   - Wywołaj `createSession()` z serwisu
   - Obsłuż błędy serwisu (batch not found → `404`, wrong status → `422`, inne → `500`)
   - Zwróć `new Response(JSON.stringify(result), { status: 201, headers: { "Content-Type": "application/json" } })`

4. **Weryfikacja triggerów bazodanowych**
   - Upewnij się, że migracja dla triggera `set_previous_sessions_abandoned` (lub analogiczna) istnieje w `supabase/migrations/`
   - Jeśli nie istnieje — utwórz migrację zgodnie z konwencją `YYYYMMDDHHmmss_abandon_in_progress_sessions_trigger.sql`

5. **Weryfikacja polityk RLS**
   - Tabela `sessions`: `INSERT` — zezwól gdy `user_id = auth.uid()`; `SELECT` — zezwól gdy `user_id = auth.uid()`
   - Tabela `rounds`: `SELECT` — zezwól gdy sesja należy do `auth.uid()` (przez join lub policy z `EXISTS`)
   - Tabela `generation_batches`: `SELECT` — zezwól gdy `user_id = auth.uid()`

6. **Dodaj typy błędów do `src/lib/errors.ts`** (jeśli nie istnieją):
   - `BatchNotFoundError`
   - `BatchNotSuccessError`

7. **Uruchom linter i napraw wszelkie błędy:**
   ```bash
   npm run lint:fix
   ```

8. **Ręczne testy integracyjne** (np. przez Postman lub `curl`):
   - `201` — poprawne dane z istniejącym batch `status=success`
   - `400` — `timer_seconds: 10` (poza zakresem)
   - `401` — brak nagłówka sesji / ciasteczka auth
   - `404` — nieistniejący `generation_batch_id`
   - `422` — batch ze statusem `pending` lub `error`
