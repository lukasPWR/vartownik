# API Endpoint Implementation Plan: POST /api/sessions/:sessionId/rounds/:roundId/complete

## 1. Przegląd punktu końcowego

`POST /api/sessions/:sessionId/rounds/:roundId/complete` oznacza rundę jako ukończoną, co skutkuje odkryciem poprawnych odpowiedzi dla każdego pytania. Endpoint stanowi bramkę między fazą rozgrywki a fazą oceny — wywołanie go jest wymagane przed możliwością przejścia do następnej rundy lub wyświetlenia ocen. Operacja jest dozwolona tylko wtedy, gdy dla każdego pytania rundy zarejestrowano przynajmniej jedną próbę (attempt) albo upłynął timer każdego pytania. Podwójne wywołanie (gdy runda jest już ukończona) jest odrzucane kodem 409.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `POST`
- **Struktura URL:** `/api/sessions/:sessionId/rounds/:roundId/complete`
- **Parametry:**
  - **Wymagane (path params):**

    | Parametr    | Typ         | Opis                                           |
    |-------------|-------------|------------------------------------------------|
    | `sessionId` | UUID string | Identyfikator sesji quizowej                   |
    | `roundId`   | UUID string | Identyfikator rundy do ukończenia              |

  - **Opcjonalne:** brak
- **Request Body:** brak
- **Nagłówki:** Cookie sesji obsługiwane przez middleware Astro (`locals.user`)

---

## 3. Wykorzystywane typy

Wszystkie wymagane typy istnieją już w `src/types.ts` — **nie trzeba dodawać nowych**.

```ts
// Odpowiedź poprawnej odpowiedzi (gwarantowana non-null po zakończeniu rundy)
interface CorrectAnswerDTO {
  primary: string;
  synonyms: string[];
}

// Element tablicy questions[] w odpowiedzi — correct_answer zawsze non-null
type CompletedRoundQuestionDTO = Omit<RoundQuestionDTO, "correct_answer"> & {
  correct_answer: CorrectAnswerDTO;
};

// Pełna odpowiedź 200 endpointu complete
interface CompleteRoundResponseDTO extends Omit<RoundDTO, "questions"> {
  questions: CompletedRoundQuestionDTO[];
}
```

**Schemat walidacji Zod (path params):**

```ts
const PathSchema = z.object({
  sessionId: z.string().uuid("sessionId must be a valid UUID"),
  roundId:   z.string().uuid("roundId must be a valid UUID"),
});
```

---

## 4. Szczegóły odpowiedzi

| Status HTTP | Opis |
|-------------|------|
| `200 OK` | Runda oznaczona jako ukończona; zwrócono `CompleteRoundResponseDTO` z odkrytymi odpowiedziami |
| `400 Bad Request` | Nie wszystkie pytania rundy mają zarejestrowaną próbę |
| `401 Unauthorized` | Użytkownik niezalogowany |
| `404 Not Found` | Sesja nie istnieje / nie należy do użytkownika, lub runda nie istnieje w tej sesji |
| `409 Conflict` | Runda jest już ukończona (`status = "completed"`) |
| `500 Internal Server Error` | Nieoczekiwany błąd po stronie serwera |

**Body odpowiedzi 200:**

```json
{
  "id": "uuid",
  "position": 1,
  "status": "completed",
  "timer_seconds": 20,
  "started_at": "2026-03-21T10:00:00Z",
  "questions": [
    {
      "position": 1,
      "question_id": "uuid",
      "question_text": "Kto zdobył Złotą Piłkę w 2023 roku?",
      "difficulty_score": 3,
      "categories": [{ "name": "Nagrody" }],
      "correct_answer": { "primary": "Lionel Messi", "synonyms": ["Messi"] }
    }
  ]
}
```

---

## 5. Przepływ danych

```
Request POST /api/sessions/:sessionId/rounds/:roundId/complete
  │
  ▼
[API route] src/pages/api/sessions/[sessionId]/rounds/[roundId]/complete.ts
  │  1. Sprawdź locals.user → 401 jeśli brak
  │  2. Wyodrębnij path params: sessionId, roundId
  │  3. Waliduj params przez Zod PathSchema → 400 jeśli błąd formatu
  │  4. Przekaż do serwisu: completeRound(supabase, sessionId, roundId, userId)
  ▼
[Service] src/lib/services/sessions.service.ts → completeRound()
  │
  │  Krok A — weryfikacja własności sesji:
  │    SELECT id, timer_seconds, questions_per_round FROM sessions
  │    WHERE id = :sessionId AND user_id = :userId
  │    → NotFoundError jeśli brak wyników
  │
  │  Krok B — pobranie rundy z licznikiem attempts:
  │    SELECT r.id, r.position, r.status, r.started_at,
  │           COUNT(a.id) AS attempts_count
  │    FROM rounds r
  │    LEFT JOIN attempts a ON a.round_id = r.id
  │    WHERE r.id = :roundId AND r.session_id = :sessionId
  │    → NotFoundError jeśli runda nie istnieje w tej sesji
  │    → ConflictError jeśli round.status = "completed"
  │    → ValidationError (400) jeśli attempts_count < questions_per_round
  │
  │  Krok C — aktualizacja statusu rundy:
  │    UPDATE rounds
  │    SET status = 'completed', completed_at = NOW()
  │    WHERE id = :roundId
  │
  │  Krok D — pobranie attempts ze snapshotami pytań:
  │    SELECT question_id, position, question_text_snapshot,
  │           difficulty_score_snapshot, correct_answer_snapshot
  │    FROM attempts
  │    WHERE round_id = :roundId
  │    ORDER BY position ASC
  │
  │  Krok E — pobranie kategorii pytań:
  │    SELECT qc.question_id, c.name
  │    FROM question_categories qc
  │    JOIN categories c ON c.id = qc.category_id
  │    WHERE qc.question_id IN (:questionIds)
  │
  │  Krok F — złożenie CompleteRoundResponseDTO:
  │    • Dla każdego attempt → CompletedRoundQuestionDTO
  │    • correct_answer zawsze wypełniony (z correct_answer_snapshot)
  │    • timer_seconds pochodzi z sesji (krok A)
  │    • Zwróć CompleteRoundResponseDTO
  ▼
[API route] — zwróć Response 200 z JSON
```

### Zapytania Supabase (szczegóły implementacji serwisu)

```ts
// Krok A — weryfikacja własności sesji
const { data: session, error: sessionError } = await supabase
  .from("sessions")
  .select("id, timer_seconds, questions_per_round")
  .eq("id", sessionId)
  .eq("user_id", userId)
  .single();

if (sessionError || !session) throw new NotFoundError("Session not found.");

// Krok B — runda z liczbą attempts
const { data: round, error: roundError } = await supabase
  .from("rounds")
  .select("id, position, status, started_at, attempts(id)")
  .eq("id", roundId)
  .eq("session_id", sessionId)
  .single();

if (roundError || !round) throw new NotFoundError("Round not found.");
if (round.status === "completed") throw new ConflictError("Round is already completed.");

const attemptsCount = round.attempts?.length ?? 0;
if (attemptsCount < session.questions_per_round) {
  throw new ValidationError(
    `Not all questions have been attempted. Expected ${session.questions_per_round}, got ${attemptsCount}.`
  );
}

// Krok C — aktualizacja statusu rundy
const { error: updateError } = await supabase
  .from("rounds")
  .update({ status: "completed", completed_at: new Date().toISOString() })
  .eq("id", roundId);

if (updateError) throw updateError;

// Krok D — attempts ze snapshotami pytań
const { data: attempts, error: attemptsError } = await supabase
  .from("attempts")
  .select("question_id, position, question_text_snapshot, difficulty_score_snapshot, correct_answer_snapshot")
  .eq("round_id", roundId)
  .order("position", { ascending: true });

if (attemptsError) throw attemptsError;

// Krok E — kategorie pytań
const questionIds = (attempts ?? []).map((a) => a.question_id);

const { data: qcRows } = await supabase
  .from("question_categories")
  .select("question_id, categories(name)")
  .in("question_id", questionIds);
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie:** Sprawdzenie `locals.user` jako pierwsze działanie handlera — zwrócenie `401` przed jakimkolwiek dostępem do bazy danych.

2. **Autoryzacja (ownership check):** Sesja pobierana z klauzulą `.eq("user_id", userId)`. Jeśli sesja nie należy do aktualnego użytkownika, Supabase nie zwróci wiersza → `404`. Dzięki temu nie ujawniamy faktu istnienia cudzych sesji ani rund.

3. **Walidacja przynależności rundy do sesji:** Runda pobierana z klauzulą `.eq("session_id", sessionId)`, co uniemożliwia ukończenie rundy należącej do innej sesji przez manipulację `roundId`.

4. **Walidacja path params przez Zod:** `sessionId` i `roundId` muszą być UUID. Przekazanie niepoprawnych wartości skutkuje `400` zanim dotkniemy bazy danych.

5. **Idempotentność / ochrona przed podwójnym wywołaniem:** Sprawdzenie `round.status === "completed"` → `409 Conflict` zamiast ponownego aktualizowania rekordu.

6. **Ochrona przed przedwczesnym ujawnieniem odpowiedzi:** Warunek sprawdzający liczbę attempts przed aktualizacją gwarantuje, że odpowiedzi są odkrywane dopiero po faktycznym wypełnieniu przez użytkownika wszystkich pytań.

7. **RLS Supabase:** Tabele `sessions`, `rounds`, `attempts`, `question_categories`, `categories` mają włączone Row Level Security. Klient `locals.supabase` (skonfigurowany z tokenem sesji użytkownika) automatycznie ogranicza widoczność danych do zalogowanego użytkownika.

8. **Brak ekspozycji szczegółów błędów DB:** W obsłudze `catch` logujemy oryginalny błąd przez `console.error` i zwracamy generyczny komunikat `500`.

---

## 7. Obsługa błędów

| Scenariusz | Rzucony wyjątek | Kod HTTP |
|---|---|---|
| Brak `locals.user` (niezalogowany) | — | `401 Unauthorized` |
| `sessionId` lub `roundId` nie jest UUID | Zod parse error | `400 Bad Request` |
| Sesja nie istnieje lub nie należy do użytkownika | `NotFoundError` | `404 Not Found` |
| Runda nie istnieje lub nie należy do tej sesji | `NotFoundError` | `404 Not Found` |
| Runda jest już ukończona | `ConflictError` | `409 Conflict` |
| Liczba attempts < questions_per_round | `ValidationError` | `400 Bad Request` |
| Błąd Supabase / nieoczekiwany wyjątek | — | `500 Internal Server Error` |

**Mapowanie wyjątków w API route:**

```ts
} catch (err) {
  if (err instanceof NotFoundError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (err instanceof ConflictError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (err instanceof ValidationError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.error("[POST /api/sessions/:sessionId/rounds/:roundId/complete]", err);
  return new Response(JSON.stringify({ error: "Internal server error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
```

> **Uwaga:** Klasa `ValidationError` nie istnieje jeszcze w `src/lib/errors.ts`. Należy ją dodać analogicznie do istniejących klas błędów:
> ```ts
> export class ValidationError extends Error {
>   constructor(message = "Validation failed.") {
>     super(message);
>     this.name = "ValidationError";
>   }
> }
> ```

---

## 8. Rozważania dotyczące wydajności

1. **Krok A + B w jednym zapytaniu (opcjonalna optymalizacja):** Sesja i runda mogą być pobrane jednym zapytaniem z nested select (`sessions → rounds`). Jednak dla czytelności i jednoznacznego mapowania błędów 404 (sesja vs. runda) zaleca się dwa oddzielne zapytania.

2. **COUNT attempts bez pobierania danych:** W kroku B używamy nested select `attempts(id)` zamiast `COUNT(*)` (Supabase JS nie wspiera natywnie `COUNT` w nested relations). Alternatywnie można użyć RPC lub sprawdzić długość tablicy po stronie TS — co i tak wymaga pobrania minimalnych danych.

3. **Krok C + D razem:** Aktualizacja statusu i pobieranie attempts mogą być wykonane sekwencyjnie — aktualizacja musi poprzedzać odpowiedź, a attempts są potrzebne do złożenia DTO. Brak możliwości równoległego wykonania.

4. **Kategorie w Kroku E:** Zapytanie `question_categories` z `IN (:questionIds)` dla maksymalnie `questions_per_round` (domyślnie 10) pytań jest wydajne. Wynik można buforować w pamięci serwisu jeśli endpoint byłby wywoływany wielokrotnie, lecz jest to jednorazowe wywołanie.

5. **Indeksy:** Upewnić się, że tabela `attempts` posiada indeks na `(round_id, position)` — wymagany dla wydajnego sortowania i filtrowania w kroku D. Sprawdzić migracje.

---

## 9. Etapy wdrożenia

1. **Dodać `ValidationError` do `src/lib/errors.ts`**
   - Analogicznie do istniejących klas `ConflictError`, `NotFoundError`.

2. **Utworzyć serwis `src/lib/services/sessions.service.ts`**
   - Wyeksportować funkcję `completeRound(supabase: SupabaseClientType, sessionId: string, roundId: string, userId: string): Promise<CompleteRoundResponseDTO>`.
   - Zaimplementować kroki A–F zgodnie z przepływem danych.
   - Importować `NotFoundError`, `ConflictError`, `ValidationError` z `@/lib/errors`.

3. **Utworzyć plik trasy API** `src/pages/api/sessions/[sessionId]/rounds/[roundId]/complete.ts`
   - Wyeksportować `export const prerender = false`.
   - Wyeksportować handler `export const POST: APIRoute`.
   - Zdefiniować `PathSchema` (Zod) dla `sessionId` i `roundId` jako UUID.
   - Sprawdzić `locals.user` → `401`.
   - Sparsować i zwalidować path params → `400` przy błędzie Zod.
   - Wywołać `completeRound()` i zwrócić `200` z `CompleteRoundResponseDTO`.
   - Obsłużyć wyjątki zgodnie z tabelą w sekcji 7.

4. **Zweryfikować, że `CompleteRoundResponseDTO` i `RoundQuestionDTO` w `src/types.ts` są kompletne**
   - Upewnić się, że `CompleteRoundResponseDTO` zawiera pole `timer_seconds` (dziedziczone przez `RoundDTO`).

5. **Przetestować ręcznie (curl / REST Client)** scenariusze:
   - Happy path (wszystkie pytania attempted → 200 z odkrytymi odpowiedziami).
   - Nie wszystkie pytania attempted → 400.
   - Runda już ukończona → 409.
   - Nieistniejące sessionId / roundId → 404.
   - Brak autoryzacji → 401.
   - roundId z innej sesji → 404.

6. **Uruchomić linter i sprawdzić błędy**
   - `npm run lint` i `npm run build` po zaimplementowaniu — poprawić ewentualne błędy typów i lint.
