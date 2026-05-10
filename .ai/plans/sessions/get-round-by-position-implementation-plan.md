# API Endpoint Implementation Plan: GET /api/sessions/:sessionId/rounds/:position

## 1. Przegląd punktu końcowego

`GET /api/sessions/:sessionId/rounds/:position` zwraca szczegóły konkretnej rundy quizowej — wraz z listą przypisanych pytań — dla zalogowanego użytkownika. Kluczowym elementem bezpieczeństwa jest **maskowanie poprawnych odpowiedzi**: pole `correct_answer` jest zwracane jako `null`, gdy runda ma status `in_progress`, i wypełniane dopiero po jej ukończeniu (`status = completed`). Endpoint konsumowany jest przez silnik gry po stronie klienta (`GameView.vue`) w celu wyświetlenia pytań aktualnej rundy.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/sessions/:sessionId/rounds/:position`
- **Parametry:**
  - **Wymagane (path params):**

    | Parametr    | Typ         | Opis                                             |
    |-------------|-------------|--------------------------------------------------|
    | `sessionId` | UUID string | Identyfikator sesji                              |
    | `position`  | integer ≥ 1 | 1-based numer rundy w ramach sesji               |

  - **Opcjonalne:** brak
- **Request Body:** brak
- **Nagłówki:** Cookie sesji (obsługiwane przez middleware Astro — `locals.user`)

---

## 3. Wykorzystywane typy

Wszystkie typy istnieją już w `src/types.ts` — **nie trzeba ich dodawać**.

```ts
// Poprawna odpowiedź — null gdy runda in_progress
interface CorrectAnswerDTO {
  primary: string;
  synonyms: string[];
}

// Element tablicy questions[] w odpowiedzi rundy
interface RoundQuestionDTO {
  position: number;                      // 1-based pozycja pytania w rundzie
  question_id: string;
  question_text: string;
  difficulty_score: number;
  categories: Pick<Tables<"categories">, "name">[];
  correct_answer: CorrectAnswerDTO | null; // null gdy runda in_progress
}

// Pełna odpowiedź endpointu
interface RoundDTO {
  id: string;
  position: number;
  status: string;                        // "in_progress" | "completed"
  timer_seconds: number;                 // dziedziczone z sesji
  questions: RoundQuestionDTO[];
  started_at: string;                    // ISO 8601
}
```

### Schemat walidacji Zod (path params)

```ts
const PathSchema = z.object({
  sessionId: z.string().uuid("sessionId must be a valid UUID"),
  position:  z.coerce.number().int().min(1, "position must be a positive integer"),
});
```

---

## 4. Szczegóły odpowiedzi

| Status HTTP | Opis |
|-------------|------|
| `200 OK` | Runda znaleziona — zwrócono `RoundDTO` |
| `401 Unauthorized` | Użytkownik niezalogowany |
| `404 Not Found` | Sesja nie istnieje / nie należy do użytkownika, lub runda o podanej pozycji nie istnieje |
| `500 Internal Server Error` | Nieoczekiwany błąd po stronie serwera |

**Body odpowiedzi 200 — runda `in_progress` (odpowiedzi zamaskowane):**

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
      "question_text": "Kto zdobył Złotą Piłkę w 2023 roku?",
      "difficulty_score": 3,
      "categories": [{ "name": "Nagrody" }],
      "correct_answer": null
    }
  ],
  "started_at": "2026-03-21T10:00:00Z"
}
```

**Body odpowiedzi 200 — runda `completed` (odpowiedzi odkryte):**

```json
{
  "id": "uuid",
  "position": 1,
  "status": "completed",
  "timer_seconds": 20,
  "questions": [
    {
      "position": 1,
      "question_id": "uuid",
      "question_text": "Kto zdobył Złotą Piłkę w 2023 roku?",
      "difficulty_score": 3,
      "categories": [{ "name": "Nagrody" }],
      "correct_answer": { "primary": "Lionel Messi", "synonyms": ["Messi"] }
    }
  ],
  "started_at": "2026-03-21T10:00:00Z"
}
```

---

## 5. Przepływ danych

```
Request GET /api/sessions/:sessionId/rounds/:position
  │
  ▼
[API route] src/pages/api/sessions/[sessionId]/rounds/[position].ts
  │  1. Sprawdź locals.user → 401 jeśli brak
  │  2. Wyodrębnij path params: sessionId, position
  │  3. Waliduj params przez Zod PathSchema → 400 jeśli błąd formatu
  │  4. Przekaż do serwisu: getRoundByPosition(supabase, sessionId, position, userId)
  ▼
[Service] src/lib/services/sessions.service.ts → getRoundByPosition()
  │
  │  Krok A — weryfikacja własności sesji:
  │    SELECT id, timer_seconds FROM sessions
  │    WHERE id = :sessionId AND user_id = :userId
  │    → NotFoundError jeśli brak wyników (sesja nie istnieje lub nie należy do usera)
  │
  │  Krok B — pobranie rundy z powiązanymi attempts:
  │    SELECT r.id, r.position, r.status, r.started_at,
  │           a.question_id, a.position, a.question_text_snapshot,
  │           a.difficulty_score_snapshot, a.correct_answer_snapshot
  │    FROM rounds r
  │    JOIN attempts a ON a.round_id = r.id
  │    WHERE r.session_id = :sessionId AND r.position = :position
  │    ORDER BY a.position ASC
  │    → NotFoundError jeśli runda nie istnieje
  │
  │  Krok C — pobranie kategorii dla pytań rundy:
  │    SELECT qc.question_id, c.name
  │    FROM question_categories qc
  │    JOIN categories c ON c.id = qc.category_id
  │    WHERE qc.question_id IN (:questionIds)
  │
  │  Krok D — złożenie RoundDTO:
  │    • Dla każdego attempt → RoundQuestionDTO
  │    • correct_answer = null  gdy round.status = "in_progress"
  │    • correct_answer = { primary, synonyms }  gdy round.status = "completed"
  │    • timer_seconds pochodzi z sesji (krok A)
  │
  │  7. Zwróć RoundDTO
  ▼
[API route] — zwróć Response 200 z JSON
```

### Zapytania Supabase (szczegóły implementacji serwisu)

```ts
// Krok A — weryfikacja własności
const { data: session, error: sessionError } = await supabase
  .from("sessions")
  .select("id, timer_seconds")
  .eq("id", sessionId)
  .eq("user_id", userId)
  .single();

if (sessionError || !session) throw new NotFoundError("Session not found.");

// Krok B — runda z attempts (snapshoty pytań)
const { data: round, error: roundError } = await supabase
  .from("rounds")
  .select(`
    id, position, status, started_at,
    attempts(question_id, position, question_text_snapshot, difficulty_score_snapshot, correct_answer_snapshot)
  `)
  .eq("session_id", sessionId)
  .eq("position", position)
  .order("position", { referencedTable: "attempts", ascending: true })
  .single();

if (roundError || !round) throw new NotFoundError("Round not found.");

// Krok C — kategorie pytań
const questionIds = round.attempts.map((a) => a.question_id);

const { data: qcRows } = await supabase
  .from("question_categories")
  .select("question_id, categories(name)")
  .in("question_id", questionIds);
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie:** Sprawdzenie `locals.user` jako pierwsze działanie handlera — zwrócenie `401` przed jakimkolwiek dostępem do bazy danych.

2. **Autoryzacja (ownership check):** Pobieranie sesji z klauzulą `.eq("user_id", userId)`. Jeśli sesja nie należy do aktualnego użytkownika, Supabase nie zwróci wiersza → `404`. Dzięki temu nie ujawniamy faktu istnienia cudzych sesji.

3. **Maskowanie odpowiedzi (answer leakage prevention):** Poprawna odpowiedź pochodzi z `correct_answer_snapshot` w tabeli `attempts`. Pole to **zawsze** istnieje w bazie, lecz serwis zwraca je jako `null` gdy `round.status === "in_progress"`. Warunkowanie odbywa się w kodzie TypeScript (nie na poziomie zapytania SQL), co eliminuje ryzyko przypadkowego ujawnienia przez zmianę zapytania.

4. **Walidacja path params przez Zod:** `sessionId` musi być UUID, `position` musi być dodatnią liczbą całkowitą. Przekazanie niepoprawnych wartości skutkuje `400` zanim dotkniemy bazy danych.

5. **RLS Supabase:** Tabele `sessions`, `rounds`, `attempts`, `question_categories`, `categories` mają włączone Row Level Security. Supabase client z `locals.supabase` (skonfigurowany z tokenem sesji użytkownika) automatycznie ogranicza widoczność danych do wierszy należących do zalogowanego użytkownika.

6. **Brak ekspozycji szczegółów błędów DB:** W obsłudze `catch` logujemy oryginalny błąd przez `console.error` i zwracamy generyczny komunikat `500`.

---

## 7. Obsługa błędów

| Scenariusz | Rzucony wyjątek / kod HTTP |
|---|---|
| Brak `locals.user` (niezalogowany) | `401 Unauthorized` |
| `sessionId` nie jest UUID | `400 Bad Request` (Zod) |
| `position` ≤ 0 lub nie jest liczbą całkowitą | `400 Bad Request` (Zod) |
| Sesja nie istnieje lub nie należy do użytkownika | `404 Not Found` (`NotFoundError`) |
| Runda o podanej pozycji nie istnieje w sesji | `404 Not Found` (`NotFoundError`) |
| Błąd Supabase / nieoczekiwany wyjątek | `500 Internal Server Error` |

**Mapowanie wyjątków w API route:**

```ts
} catch (err) {
  if (err instanceof NotFoundError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.error("[GET /api/sessions/:sessionId/rounds/:position]", err);
  return new Response(JSON.stringify({ error: "Internal server error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
```

---

## 8. Rozważania dotyczące wydajności

1. **Dwa zapytania zamiast jednego złączonego widoku:** Rozdzielenie pobierania sesji (weryfikacja) od rundy z attempts poprawia czytelność, ale generuje 3 round-tripy (session → round+attempts → categories). Jeśli profil wydajnościowy pokaże wąskie gardło, można je scalić w jedno zapytanie z wielokrotnym zagnieżdżeniem.

2. **Indeks na `rounds(session_id, position)`:** Para `(session_id, position)` jest kluczem wyszukiwania rundy — indeks kompozytowy (jeśli jeszcze nie istnieje) eliminuje sekwencyjny skan tabeli.

3. **Indeks na `attempts(round_id, position)`:** Attempts są pobierane po `round_id` i sortowane po `position` — indeks kompozytowy jest niezbędny przy sesjach z wieloma rundami i wieloma pytaniami.

4. **Indeks na `question_categories(question_id)`:** Zapytanie o kategorie filtruje po `question_id IN (...)` — indeks B-tree na tej kolumnie przyspiesza operację.

5. **Brak paginacji:** Endpoint zwraca wszystkie pytania rundy (domyślnie 10 per runda). Nie ma potrzeby paginacji, ponieważ liczba pytań jest stała i mała.

6. **Cache po stronie klienta:** Ukończona runda (`status = completed`) jest niezmiennicza — klient może ją cachować lokalnie (np. przez Nano Stores) i unikać ponownego fetchowania.

---

## 9. Etapy wdrożenia

1. **Utwórz plik API route:** `src/pages/api/sessions/[sessionId]/rounds/[position].ts`
   - Dodaj `export const prerender = false`
   - Zdefiniuj Zod `PathSchema` do walidacji `sessionId` (UUID) i `position` (int ≥ 1)
   - Zaimplementuj `GET` handler: sprawdź `locals.user` → sparsuj path params → wywołaj serwis → obsłuż błędy → zwróć `Response`

2. **Utwórz serwis:** `src/lib/services/sessions.service.ts`
   - Zaimplementuj i wyeksportuj `getRoundByPosition(supabase, sessionId, position, userId): Promise<RoundDTO>`
   - Krok A: zapytanie o sesję z filtrem `user_id` → rzuć `NotFoundError` jeśli brak
   - Krok B: zapytanie o rundę z `attempts` (pola snapshot) filtrowane po `session_id` + `position` → rzuć `NotFoundError` jeśli brak
   - Krok C: zapytanie o `question_categories` + `categories(name)` dla wszystkich `question_id` z attempts
   - Krok D: złóż mapę `questionId → categoryNames[]`
   - Krok E: mapuj attempts na `RoundQuestionDTO[]`, ustawiając `correct_answer = null` gdy `round.status === "in_progress"`, lub parsując `correct_answer_snapshot` jako `CorrectAnswerDTO` gdy `completed`
   - Krok F: złóż i zwróć `RoundDTO` z `timer_seconds` z sesji

3. **Dodaj typy pomocnicze wewnątrz serwisu (lokalne, nie do types.ts):**
   - `RawAttemptRow` — typ opisujący dane z Supabase (snapshot fields)
   - `RawCategoryRow` — typ opisujący `{ question_id, categories: { name } | null }`

4. **Sprawdź linter i typy:**
   - Uruchom `npm run lint` i `npm run build` — zweryfikuj brak błędów TypeScript i ESLint

5. **Manualne testy E2E (Supabase local):**
   - Scenariusz 1: `GET` rundy `in_progress` → sprawdź, że `correct_answer === null` dla każdego pytania
   - Scenariusz 2: `GET` rundy `completed` → sprawdź, że `correct_answer` zawiera `{ primary, synonyms }`
   - Scenariusz 3: niepoprawny `sessionId` (nie-UUID) → oczekiwany `400`
   - Scenariusz 4: `sessionId` innego użytkownika → oczekiwany `404`
   - Scenariusz 5: nieistniejąca `position` (np. 99) → oczekiwany `404`
   - Scenariusz 6: brak tokenu sesji → oczekiwany `401`
