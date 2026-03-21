# API Endpoint Implementation Plan: POST /api/generation-batches

## 1. Przegląd punktu końcowego

Endpoint inicjuje generowanie pełnego zestawu quizowego (domyślnie 40 pytań / 4 rundy) przez OpenRouter API po stronie serwera. Działa **synchronicznie z inline-wait**: po przyjęciu żądania serwer od razu wywołuje OpenRouter, zapisuje pytania do bazy i zwraca `202 success` w tej samej odpowiedzi HTTP (lub `201 pending` jeśli generacja jeszcze trwa / zostanie przeniesiona do trybu asynchronicznego). Obsługuje mechanizm ponownych prób (max 2 retry przy niepoprawnym JSON) i deduplikację pytań po `content_hash`.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `POST`
- **Struktura URL:** `/api/generation-batches`
- **Nagłówki:** `Content-Type: application/json`, cookie sesji Supabase (wymagane)

### Parametry

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `model` | `string` | Tak | Identyfikator modelu LLM, np. `"gpt-4o"` |
| `provider` | `string` | Tak | Dostawca, np. `"openrouter"` |
| `prompt_version` | `string` | Tak | Wersja promptu, np. `"v1"` |
| `requested_questions_count` | `number` | Tak | Liczba pytań do wygenerowania (domyślnie 40) |

### Zod Schema (walidacja wejścia)

```ts
const CreateGenerationBatchSchema = z.object({
  model: z.string().min(1).max(100),
  provider: z.enum(["openrouter"]),       // dozwoleni dostawcy
  prompt_version: z.string().regex(/^v\d+$/), // np. "v1", "v2"
  requested_questions_count: z.number().int().positive().default(40),
});
```

---

## 3. Wykorzystywane typy

Wszystkie typy zdefiniowane w `src/types.ts`:

- **`CreateGenerationBatchCommand`** — zwalidowane ciało żądania
- **`GenerationBatchCreatedDTO`** — odpowiedź `201` (status `pending`)
- **`GenerationBatchSuccessDTO`** — odpowiedź `202` (status `success`)
- **`RoundQuestionGroupDTO`** — grupowanie `question_ids` per runda w odpowiedzi `202`
- **`CorrectAnswerDTO`** — struktura `correct_answer` pytania

---

## 4. Szczegóły odpowiedzi

### `201 Created` — batch przyjęty, generacja jeszcze w toku

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

### `202 Accepted` — generacja zakończona w trakcie tego samego żądania

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

### Kody błędów

| Kod | Powód |
|---|---|
| `400 Bad Request` | Nieprawidłowy model, provider lub prompt_version; błąd walidacji Zod |
| `401 Unauthorized` | Brak ważnej sesji (obsługa w middleware) |
| `422 Unprocessable Entity` | AI zwróciło niepoprawny JSON po max retries |
| `429 Too Many Requests` | Rate limit — za dużo żądań generacji od użytkownika |
| `502 Bad Gateway` | Błąd upstream OpenRouter (sieciowy, HTTP 5xx) |

---

## 5. Przepływ danych

```
Client
  └─ POST /api/generation-batches
       │
       ├─ [middleware] Weryfikacja sesji → context.locals.user
       │
       ├─ [route handler] src/pages/api/generation-batches/index.ts
       │     1. Zod parse ciała żądania → 400 jeśli invalid
       │     2. Rate-limit check (liczba aktywnych/pending batchy w ostatnich N min) → 429
       │     3. Wywołanie GenerationBatchService.create(command, userId, supabase)
       │
       ├─ [GenerationBatchService] src/lib/services/generation-batch.service.ts
       │     1. INSERT generation_batches (status='pending') → pobierz batchId
       │     2. Wywołaj OpenRouterClient.generateQuestions(model, promptVersion, count)
       │         ├─ Sukces → parsuj JSON odpowiedzi
       │         └─ Błąd JSON → retry (max 2), inkrementuj retry_count
       │               └─ Po max retries → UPDATE batch status='failed' → throw 422
       │     3. Deduplikacja pytań po SHA-256(normalize(question_text)) — pomijaj duplikaty
       │     4. Batch INSERT questions + question_categories
       │     5. Dystrybucja do rund: pytania[0..9] → round 1, [10..19] → round 2 itd.
       │     6. UPDATE generation_batches SET status='success', returned_questions_count, estimated_cost_usd, finished_at
       │     7. Zwróć GenerationBatchSuccessDTO z question_ids per runda
       │
       └─ [route handler] Zwróć 202 + GenerationBatchSuccessDTO
                          (lub 201 + GenerationBatchCreatedDTO w trybie async)
```

### Moduły do stworzenia

| Plik | Odpowiedzialność |
|---|---|
| `src/pages/api/generation-batches/index.ts` | Route handler (POST export) |
| `src/lib/services/generation-batch.service.ts` | Orchestracja: DB insert, OpenRouter call, dedup, distribution |
| `src/lib/openrouter.client.ts` | Izolowany klient HTTP do OpenRouter API |
| `src/lib/prompts/quiz-generation.v1.ts` | Stały few-shot prompt dla `v1` |

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnianie:** Middleware `src/middleware/index.ts` weryfikuje sesję Supabase na każdym żądaniu. Brak sesji → `401` (before route handler).

2. **Klucz API OpenRouter:** Przechowywany wyłącznie jako `astro:env/server` zmienna (nigdy nie trafia do klienta). Typ: `string`, `secret: true` w `astro.config.mjs`.

3. **Authorization:** Supabase client pobierany z `context.locals.supabase` (utwardzony cookie session). RLS na tabeli `generation_batches` zapewnia, że `user_id = auth.uid()` — użytkownik nie może odczytać ani modyfikować batchy innych.

4. **Walidacja wejścia:** Zod schema po stronie serwera przed jakimkolwiek I/O — chroni przed injection do `model`/`prompt_version` pól używanych w payload do OpenRouter.

5. **Rate limiting:** Przed wywołaniem OpenRouter sprawdź, ile `generation_batches` użytkownik stworzył w ostatnich 10 minutach (query po `user_id, created_at, status`). Limit np. 3 batchy / 10 min → `429`. Zapobiega nadużyciom kosztów API.

6. **Sanityzacja pytań z AI:** Przed zapisem do DB parsuj pola `question_text` i `correct_answer` przez dedykowane Zod schematy — AI może zwrócić niespodziewane typy.

7. **Content hash:** SHA-256 z `trim().toLowerCase()` pytania — deduplikacja chroni przed powtórzonym zapisem nawet przy retry.

8. **Timeout OpenRouter:** Ustaw twardy timeout (np. 60s) na wywołanie HTTP, żeby nie blokować połączenia na czas nieokreślony.

---

## 7. Obsługa błędów

| Scenariusz | Akcja | Kod HTTP |
|---|---|---|
| Nieprawidłowe ciało żądania (Zod) | Zwróć szczegóły błędu z `issues` | `400` |
| Niedozwolony `provider` lub `prompt_version` | Zwróć komunikat walidacji | `400` |
| Brak sesji / wygasły token | Obsługuje middleware | `401` |
| Przekroczony rate limit generacji | Zwróć `Retry-After` header | `429` |
| OpenRouter HTTP error (4xx/5xx) | Loguj error, zwróć 502 | `502` |
| Timeout połączenia do OpenRouter | Traktuj jak 502 | `502` |
| Niepoprawny JSON z AI (po 1. próbie) | Inkrementuj `retry_count`, ponów | — |
| Niepoprawny JSON po max retries | UPDATE batch `status='failed'`, `error_message` | `422` |
| Duplikat `content_hash` | Pomiń pytanie (nie błąd) | — |
| Błąd DB (INSERT failed) | Loguj, zwróć 500 | `500` |

Logowanie błędów: używaj `console.error` z `batchId` i `userId` w każdym catch — nie loguj treści pytań (dane użytkownika).

---

## 8. Rozważania dotyczące wydajności

1. **Synchroniczny inline-wait:** Generacja AI dla 40 pytań może trwać 15–45s. Astro SSR obsługuje długie żądania, ale należy ustawić timeout serwera Node.js odpowiednio (nie mniejszy niż 90s).

2. **Batch INSERT pytań:** Zamiast 40 pojedynczych insertów — jeden `INSERT INTO questions SELECT unnest(...)` lub wielowierszowy INSERT przez Supabase `insert([...], { count: 'exact' })`.

3. **Batch INSERT question_categories:** Analogicznie — jeden INSERT dla wszystkich wierszy junction table.

4. **Transakcja DB:** Cztery operacje (batch update + questions insert + question_categories insert + round distribution) powinny być objęte transakcją. W Supabase JS użyj RPC z funkcją `security definer` lub RPC wrapping transaction.

5. **Content hash w pamięci:** Policz SHA-256 w pamięci Node.js (`crypto.createHash`) zanim zrobisz zapytanie sprawdzające duplikat.

6. **Nie pobieraj pytań po insercie:** Użyj wartości zwróconej przez `.insert(...).select('id')` Supabase, żeby od razu mieć UUIDs bez dodatkowego SELECT.

---

## 9. Etapy implementacji

1. **Dodaj zmienną środowiskową** `OPENROUTER_API_KEY` do `astro.config.mjs` jako `secret: true` (server-only) i do pliku `.env`.

2. **Utwórz `src/lib/openrouter.client.ts`:**
   - Eksportuj funkcję `generateQuizQuestions(model, promptVersion, count)`.
   - Przyjmuje odpowiedź JSON z OpenRouter, rzuca `OpenRouterError` przy HTTP != 2xx.
   - Ustawia `AbortSignal.timeout(60_000)`.

3. **Utwórz `src/lib/prompts/quiz-generation.v1.ts`:**
   - Stały few-shot prompt generujący JSON z tablicą pytań (`question_text`, `correct_answer`, `difficulty_score`, `category_slug`).
   - Eksportuj funkcję `buildPrompt(count: number): string`.

4. **Utwórz Zod schematy w `src/lib/services/generation-batch.service.ts`:**
   - `AiQuestionSchema` — walidacja pojedynczego pytania zwróconego przez AI.
   - `AiResponseSchema` — walidacja tablicy pytań.

5. **Utwórz `src/lib/services/generation-batch.service.ts`:**
   - `checkRateLimit(userId, supabase)` — query `generation_batches` WHERE `user_id = userId AND created_at > now() - interval '10 minutes'`.
   - `createBatch(command, userId, supabase)` — INSERT pending batch, zwróć `batchId`.
   - `callOpenRouterWithRetry(model, promptVersion, count)` — pętla do 3 prób (max 2 retry).
   - `deduplicateAndInsertQuestions(questions, userId, batchId, supabase)` — oblicz content_hash, pomiń duplikaty, batch INSERT.
   - `distributeToRounds(questionIds, questionsPerRound)` — podziel na tablice po N elementów.
   - `finalizeBatch(batchId, result, supabase)` — UPDATE status, cost, finished_at.
   - `createGenerationBatch(command, userId, supabase): Promise<GenerationBatchSuccessDTO | GenerationBatchCreatedDTO>` — główna kompozycja.

6. **Utwórz `src/pages/api/generation-batches/index.ts`:**
   - `export const prerender = false`
   - `export async function POST({ request, locals }):`
     - Pobierz `supabase`, `user` z `locals` — jeśli brak user → `401`.
     - Sparsuj ciało → Zod validate → `400` jeśli invalid.
     - Wywołaj `GenerationBatchService.createGenerationBatch(command, user.id, supabase)`.
     - Zwróć `201` lub `202` z odpowiednim DTO jako JSON.
     - Obsłuż znane błędy (klasy custom error) na właściwe kody HTTP.

7. **Utwórz klasy błędów** `src/lib/errors.ts`:
   - `RateLimitError extends Error`
   - `OpenRouterError extends Error` (z `statusCode` upstream)
   - `AiParseError extends Error` (po wyczerpaniu retries)

8. **Zwaliduj poprawność typów** przez `tsc --noEmit` — upewnij się, że brak błędów TypeScript.

9. **Ręcznie przetestuj** endpoint lokalnie (Supabase local + zmienne środowiskowe) używając `curl` lub narzędzia HTTP (np. Bruno/Postman):
   - Prawidłowe żądanie → `202`.
   - Brak sesji → `401`.
   - Nieprawidłowy model → `400`.
   - Wymuszone błędy JSON (mock OpenRouter) → `422`.

10. **Uruchom `npm run lint`** i popraw ewentualne ostrzeżenia ESLint przed commitem.
