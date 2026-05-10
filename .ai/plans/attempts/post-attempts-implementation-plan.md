# API Endpoint Implementation Plan: POST /api/rounds/:roundId/attempts

## 1. Przegląd punktu końcowego

Endpoint służy do przesyłania odpowiedzi (scratchpad) dla pojedynczego pytania podczas aktywnej rundy. Tworzy rekord `attempt` powiązany z daną rundą, pytaniem i sesją użytkownika. Realizuje user story US-003 (odpowiadanie na pytania w trakcie quizu). Endpoint wymaga, aby runda była w stanie `in_progress` i aby dana pozycja (position) nie była jeszcze zajęta przez wcześniejszy attempt.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `POST`
- **Struktura URL:** `/api/rounds/:roundId/attempts`
- **Parametry:**
  - Wymagane (URL): `roundId` (UUID rundy)
  - Opcjonalne: brak parametrów query
- **Request Body:**

```json
{
  "question_id": "uuid",
  "position": 3,
  "scratchpad": "Lewandowski 2021",
  "time_taken_ms": 14500,
  "timer_expired": false
}
```

| Pole           | Typ              | Wymagane | Opis                                               |
|----------------|------------------|----------|----------------------------------------------------|
| `question_id`  | `string` (UUID)  | Tak      | ID pytania, na które odpowiada użytkownik          |
| `position`     | `number` (int)   | Tak      | 1-bazowana pozycja pytania w rundzie               |
| `scratchpad`   | `string \| null` | Nie      | Treść odpowiedzi wpisana przez użytkownika         |
| `time_taken_ms`| `number` (int)   | Tak      | Czas odpowiedzi w milisekundach (≥ 0)              |
| `timer_expired`| `boolean`        | Tak      | Czy timer wygasł przed przesłaniem odpowiedzi      |

---

## 3. Wykorzystywane typy

Z `src/types.ts` — typy już istniejące, gotowe do użycia:

```typescript
// Command model — walidacja body żądania
interface CreateAttemptCommand {
  question_id: string;
  position: number;
  scratchpad?: string | null;
  time_taken_ms: number;
  timer_expired: boolean;
}

// DTO — kształt odpowiedzi 201
interface AttemptDTO {
  id: number;
  question_id: string;
  position: number;
  scratchpad: string | null;
  time_taken_ms: number;
  timer_expired: boolean;
  verdict: AttemptVerdict | null;
  is_flagged_by_user: boolean;
  created_at: string;
}
```

Schemat Zod do walidacji wejścia (do zdefiniowania w pliku endpointu):

```typescript
const CreateAttemptSchema = z.object({
  question_id: z.string().uuid(),
  position: z.number().int().min(1),
  scratchpad: z.string().max(1000).nullable().optional(),
  time_taken_ms: z.number().int().min(0),
  timer_expired: z.boolean(),
});
```

---

## 4. Szczegóły odpowiedzi

### Sukces — `201 Created`

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

### Błędy

| Kod HTTP | Scenariusz                                                         |
|----------|--------------------------------------------------------------------|
| `400`    | Nieprawidłowe dane wejściowe (schema Zod), runda nie jest `in_progress` |
| `401`    | Użytkownik nie jest uwierzytelniony                                |
| `404`    | `roundId` nie istnieje lub nie należy do zalogowanego użytkownika; `question_id` nie istnieje lub nie jest przypisane do tej rundy |
| `409`    | Attempt dla tej pozycji (`position`) już istnieje w tej rundzie    |
| `500`    | Nieoczekiwany błąd serwera                                         |

---

## 5. Przepływ danych

```
POST /api/rounds/:roundId/attempts
  │
  ├─ [Astro API route] Parsowanie i walidacja Zod body żądania
  │     └─ Błąd parsowania → 400 Bad Request
  │
  ├─ [Middleware] Weryfikacja sesji użytkownika (context.locals.user)
  │     └─ Brak sesji → 401 Unauthorized
  │
  ├─ [AttemptsService.createAttempt(supabase, userId, roundId, command)]
  │     │
  │     ├─ Fetch rundy: SELECT * FROM rounds WHERE id = roundId
  │     │     └─ Nie znaleziono → NotFoundError → 404
  │     │
  │     ├─ Weryfikacja właściciela: JOIN sessions WHERE user_id = userId
  │     │     └─ Nie pasuje → NotFoundError → 404
  │     │
  │     ├─ Walidacja statusu rundy: round.status === 'in_progress'
  │     │     └─ Inny status → BadRequestError → 400
  │     │
  │     ├─ Weryfikacja pytania: SELECT id FROM questions WHERE id = question_id AND id IN round_questions
  │     │     └─ Nie znaleziono → NotFoundError → 404
  │     │
  │     ├─ Sprawdzenie kolizji pozycji: SELECT id FROM attempts WHERE round_id = roundId AND position = position
  │     │     └─ Istnieje → ConflictError → 409
  │     │
  │     ├─ Pobranie snapshotu pytania: SELECT question_text, correct_answer, difficulty_score FROM questions
  │     │
  │     ├─ Pobranie session_id: z obiektu rundy (round.session_id)
  │     │
  │     └─ INSERT INTO attempts (...) RETURNING *
  │           └─ Błąd bazy → 500 Internal Server Error
  │
  └─ Mapowanie wiersza na AttemptDTO → Response 201
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnianie:** Endpoint musi być chroniony. Middleware (`src/middleware.ts`) weryfikuje sesję Supabase przy każdym żądaniu i dołącza `context.locals.user`. Brak użytkownika → natychmiastowe 401.

2. **Autoryzacja (ownership check):** Przed wstawieniem rekordu serwis musi zweryfikować, że `roundId` należy do sesji powiązanej z `user_id` zalogowanego użytkownika. Bez tego użytkownik mógłby przesyłać odpowiedzi do cudzych rund. Należy używać zapytania z JOIN przez `sessions.user_id = userId`.

3. **Walidacja wejścia Zod:** Każde pole body musi być zweryfikowane przed przetwarzaniem. Schemat Zod odrzuca nieznane klucze (`z.object().strict()` opcjonalnie), chroniąc przed mass assignment.

4. **RLS Supabase:** Tabela `attempts` powinna mieć politykę RLS (`INSERT`) zezwalającą tylko na wstawianie wierszy, gdzie `user_id = auth.uid()`. To stanowi drugą warstwę zabezpieczeń poza logiką aplikacji.

5. **Snapshot pytania:** Pola `correct_answer_snapshot`, `question_text_snapshot`, `difficulty_score_snapshot` muszą być kopiowane ze stanu pytania w momencie odpowiedzi — nie mogą być przekazywane przez klienta. Chroni to integralność danych historycznych.

6. **Brak ekspozycji poprawnej odpowiedzi:** Endpoint nie zwraca `correct_answer` w odpowiedzi — `verdict` pozostaje `null` (ocena następuje po zakończeniu rundy). Zapobiega to wyciekowi odpowiedzi przez API.

---

## 7. Obsługa błędów

| Błąd (klasa)       | HTTP | Warunek                                                                 |
|--------------------|------|-------------------------------------------------------------------------|
| `ZodError`         | 400  | Nieprawidłowe/brakujące pola w body żądania                             |
| `BadRequestError`  | 400  | `round.status !== 'in_progress'`                                        |
| `NotFoundError`    | 404  | Runda nie istnieje, nie należy do użytkownika lub `question_id` nieznane|
| `ConflictError`    | 409  | Attempt dla tej `position` w tej rundzie już istnieje                   |
| Nieznany błąd      | 500  | Błąd bazy danych lub inny nieoczekiwany wyjątek                         |

Należy dodać klasę `BadRequestError` do `src/lib/errors.ts` (analogicznie do `ConflictError` i `NotFoundError`):

```typescript
export class BadRequestError extends Error {
  constructor(message = "Invalid request.") {
    super(message);
    this.name = "BadRequestError";
  }
}
```

Obsługa w warstwie endpointu:

```typescript
} catch (err) {
  if (err instanceof ZodError) return new Response(JSON.stringify({ error: err.flatten() }), { status: 400 });
  if (err instanceof BadRequestError) return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  if (err instanceof NotFoundError) return new Response(JSON.stringify({ error: err.message }), { status: 404 });
  if (err instanceof ConflictError) return new Response(JSON.stringify({ error: err.message }), { status: 409 });
  console.error("[POST /api/rounds/:roundId/attempts]", err);
  return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
}
```

---

## 8. Rozważania dotyczące wydajności

1. **Indeks unikalny na `(round_id, position)`:** Baza danych powinna posiadać indeks unikalny na kolumnach `round_id` i `position` w tabeli `attempts`. Zapobiega to race condition przy równoczesnych żądaniach i eliminuje potrzebę ręcznego sprawdzania konfliktu — błąd unikalności z bazy zostanie przechwycony jako `ConflictError`.

2. **Minimalny zestaw zapytań:** Przepływ wymaga 3–4 zapytań do bazy (pobranie rundy z sesją, weryfikacja pytania, INSERT). Można zredukować do 2 przez użycie widoku lub RPC Supabase, ale nie jest to konieczne na tym etapie.

3. **Brak N+1:** Snapshot pytania i weryfikacja jego przynależności do rundy powinny być wykonane w jednym zapytaniu.

---

## 9. Etapy wdrożenia

1. **Dodać `BadRequestError` do `src/lib/errors.ts`** — nowa klasa błędu analogiczna do `NotFoundError`.

2. **Utworzyć plik serwisu `src/lib/services/attempts.service.ts`** z funkcją `createAttempt(supabase, userId, roundId, command)`:
   - Fetch rundy + sesji (JOIN) z weryfikacją `user_id`
   - Walidacja `round.status === 'in_progress'`
   - Weryfikacja `question_id` — sprawdzenie, czy pytanie istnieje w DB
   - Sprawdzenie duplikatu pozycji (SELECT z `round_id` + `position`)
   - Pobranie snapshotu pytania (`question_text`, `correct_answer`, `difficulty_score`)
   - INSERT do tabeli `attempts` z wszystkimi polami włącznie ze snapshotem
   - Mapowanie wyniku na `AttemptDTO`

3. **Utworzyć plik endpointu `src/pages/api/rounds/[roundId]/attempts/index.ts`**:
   - Eksport `const prerender = false`
   - Eksport funkcji `POST` z `APIContext`
   - Weryfikacja `context.locals.user` → 401
   - Pobranie `roundId` z `context.params.roundId`
   - Parsowanie i walidacja body przez schemat Zod `CreateAttemptSchema`
   - Wywołanie `createAttempt` z serwisu
   - Obsługa błędów (try/catch z mapowaniem klas błędów na HTTP)
   - Zwrócenie `new Response(JSON.stringify(attemptDTO), { status: 201 })`

4. **Zweryfikować migracje bazy danych** — upewnić się, że tabela `attempts` posiada:
   - Indeks unikalny `UNIQUE(round_id, position)`
   - Politykę RLS dla `INSERT` zezwalającą tylko właścicielowi (`user_id = auth.uid()`)

5. **Uruchomić linter i sprawdzić błędy typów** (`npm run lint`) — naprawić ewentualne problemy.
