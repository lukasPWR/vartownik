# API Endpoint Implementation Plan: GET /api/generation-batches

## 1. Przegląd punktu końcowego

Endpoint zwracający paginowaną listę partii generacji pytań należących do zalogowanego użytkownika. Obsługuje filtrowanie po statusie (`pending | success | failed`) oraz standardową paginację (`page`, `limit`). Służy panelowi admina do przeglądu historii i monitorowania zadań AI.

## 2. Szczegóły żądania

- **Metoda HTTP:** GET
- **Struktura URL:** `/api/generation-batches`
- **Parametry:**
  - Wymagane: brak
  - Opcjonalne (query string):
    - `page` — numer strony, domyślnie `1`, min `1`
    - `limit` — rozmiar strony, domyślnie `20`, min `1`, max `100`
    - `status` — filtr statusu, enum: `pending | success | failed`
- **Request Body:** brak

## 3. Wykorzystywane typy

### Nowy typ do dodania w `src/types.ts`

```ts
/** GET /api/generation-batches response envelope. */
export interface ListGenerationBatchesResponseDTO {
  data: GenerationBatchDTO[];
  pagination: PaginationDTO;
}
```

### Istniejące typy

- `GenerationBatchDTO` z `src/types.ts` — kształt pojedynczej partii w liście
- `PaginationDTO` z `src/types.ts` — standardowa koperta paginacji `{ page, limit, total }`

### Schema walidacji zapytania (do dodania w serwisie)

```ts
export const ListGenerationBatchesQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "success", "failed"]).optional(),
});

export type ListGenerationBatchesQuery = z.infer<typeof ListGenerationBatchesQuerySchema>;
```

## 4. Szczegóły odpowiedzi

### 200 OK

```json
{
  "data": [
    {
      "id": "uuid",
      "status": "success",
      "model": "gpt-4o",
      "provider": "openrouter",
      "prompt_version": "v1",
      "requested_questions_count": 40,
      "returned_questions_count": 40,
      "retry_count": 0,
      "estimated_cost_usd": 0.012345,
      "error_message": null,
      "finished_at": "2026-03-21T10:00:28Z",
      "created_at": "2026-03-21T09:59:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 7
  }
}
```

### Kody statusu

| Kod | Sytuacja |
|-----|----------|
| 200 | Lista pobrana pomyślnie (może być pusta) |
| 400 | Nieprawidłowe parametry query (np. `limit` poza zakresem, `status` o nieprawidłowej wartości) |
| 401 | Użytkownik niezalogowany |
| 500 | Błąd po stronie serwera (Supabase) |

## 5. Przepływ danych

```
Klient → GET /api/generation-batches?page=1&limit=20&status=success
  → Astro route handler (src/pages/api/generation-batches/index.ts :: GET)
    1. Walidacja Zod: searchParams przez ListGenerationBatchesQuerySchema
    2. Sprawdzenie auth: locals.user (lub TEST_USER_ID)
    3. Wywołanie serwisu: listGenerationBatches(supabase, query, userId)
      → Supabase query:
          SELECT id, status, model, provider, prompt_version,
                 requested_questions_count, returned_questions_count,
                 retry_count, estimated_cost_usd, error_message,
                 finished_at, created_at
          FROM generation_batches
          WHERE user_id = :userId
            [AND status = :status]   -- opcjonalnie
          ORDER BY created_at DESC
          RANGE [offset, offset + limit - 1]   -- .range(offset, offset+limit-1)
      → COUNT(*) z tymi samymi filtrami (osobne zapytanie lub count: "exact" w Supabase)
      → return ListGenerationBatchesResponseDTO
    4. Serialization → JSON Response 200
```

## 6. Względy bezpieczeństwa

- **Autentykacja:** Weryfikacja `locals.user` ustawianego przez middleware. Brak użytkownika → 401. *(Tymczasowo TEST_USER_ID — przywrócić przed produkcją.)*
- **Autoryzacja:** Filtr `user_id = :userId` w każdym zapytaniu — użytkownik widzi wyłącznie swoje partie.
- **RLS Supabase:** Polityka `SELECT` na `generation_batches` ograniczona do `user_id = auth.uid()` — dodatkowa warstwa obrony.
- **Walidacja wejścia:** `z.coerce.number()` konwertuje string z query string do liczby przed walidacją; `z.enum` odrzuca dowolne inne wartości `status`.
- **Limit zasobów:** Maksymalny `limit = 100` zapobiega pobieraniu nadmiernej ilości danych w jednym żądaniu.
- **Brak ujawniania wewnętrznych błędów:** Odpowiedź 500 jest generyczna; szczegóły logowane po stronie serwera.

## 7. Obsługa błędów

| Scenariusz | Klasa błędu | Kod HTTP | Treść odpowiedzi |
|-----------|-------------|----------|-----------------|
| Nieprawidłowe query params (np. `limit=abc`, `status=unknown`) | (Zod) | 400 | `{ "error": "Validation failed", "issues": [...] }` |
| Brak sesji użytkownika | — | 401 | `{ "error": "Unauthorized" }` |
| Błąd Supabase (sieć, timeout) | — | 500 | `{ "error": "Internal server error" }` |

Brak wyników nie jest błędem — zwracamy `{ "data": [], "pagination": { "page": 1, "limit": 20, "total": 0 } }` z kodem 200.

## 8. Rozważania dotyczące wydajności

- **Indeks:** Kolumna `generation_batches(user_id, created_at DESC)` powinna mieć indeks złożony wspierający zarówno filtrowanie po `user_id`, jak i sortowanie po dacie.
- **Indeks warunkowy dla `status`:** Jeśli filtrowanie po statusie jest często stosowane, rozważyć `(user_id, status, created_at DESC)`.
- **Count "exact":** Supabase `{ count: "exact" }` wykonuje dodatkowe `COUNT(*)`. Przy dużych zbiorach danych rozważyć `"estimated"` lub cache'owanie liczby total.
- **SELECT tylko potrzebnych kolumn:** Pomijamy `request_payload` i `response_payload` (duże kolumny JSON) — nie są potrzebne w liście.
- **Paginacja serwerowa (RANGE):** Zamiast pobierać wszystkie rekordy i przycinać w JS, używamy `.range(offset, offset + limit - 1)` po stronie Supabase.

## 9. Etapy wdrożenia

1. **Dodaj `ListGenerationBatchesResponseDTO` do `src/types.ts`** — interfejs `{ data: GenerationBatchDTO[], pagination: PaginationDTO }`.

2. **Dodaj `ListGenerationBatchesQuerySchema` i `ListGenerationBatchesQuery` do `src/lib/services/generation-batch.service.ts`** — schemat Zod z `page`, `limit`, `status`.

3. **Dodaj metodę serwisową `listGenerationBatches` w `src/lib/services/generation-batch.service.ts`:**
   - Sygnatura: `async function listGenerationBatches(supabase: SupabaseClientType, query: ListGenerationBatchesQuery, userId: string): Promise<ListGenerationBatchesResponseDTO>`
   - Oblicz `offset = (query.page - 1) * query.limit`
   - Zbuduj zapytanie: `.from("generation_batches").select("id, status, model, provider, prompt_version, requested_questions_count, returned_questions_count, retry_count, estimated_cost_usd, error_message, finished_at, created_at", { count: "exact" }).eq("user_id", userId)`
   - Warunkowo dodaj `.eq("status", query.status)` jeśli status podany
   - Dodaj `.order("created_at", { ascending: false }).range(offset, offset + query.limit - 1)`
   - Jeśli błąd Supabase → `console.error` + rzuć Error
   - Zwróć `{ data, pagination: { page: query.page, limit: query.limit, total: count ?? 0 } }`

4. **Dodaj handler `GET` w `src/pages/api/generation-batches/index.ts`** (obok istniejącego `POST`):
   - `export const GET: APIRoute = async ({ locals, request }) => { ... }`
   - Parsuj `new URL(request.url).searchParams` → `Object.fromEntries(searchParams)`
   - Waliduj przez `ListGenerationBatchesQuerySchema.safeParse(rawQuery)` → 400 jeśli błąd
   - Sprawdź `locals.user` → 401 jeśli brak (zachowaj TEST_USER_ID dla dev)
   - Wywołaj `listGenerationBatches(locals.supabase, parsed.data, userId)`
   - Zwróć `Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } })`
   - Catch → `console.error("[GET /api/generation-batches]", err)` + 500

5. **Eksportuj nowe funkcje serwisowe** z `generation-batch.service.ts` (upewnij się, że są w named exports lub default export).

6. **Weryfikacja typów i lint:** Uruchom `npm run lint` i popraw ewentualne błędy. Upewnij się, że `ListGenerationBatchesQuerySchema` i `ListGenerationBatchesResponseDTO` są eksportowane.

7. **Test manualny / curl:** Sprawdź scenariusze: brak filtrów, filtr `status=pending`, paginacja `page=2&limit=5`, nieprawidłowy `status=unknown`, `limit=0`.
