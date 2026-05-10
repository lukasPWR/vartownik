# API Endpoint Implementation Plan: GET /api/generation-batches/:id

## 1. Przegląd punktu końcowego

Endpoint do odpytywania statusu pojedynczej partii generacji pytań (generation batch). Umożliwia klientowi polling stanu asynchronicznego zadania AI — od statusu `pending` przez `success` do `failed`. Zwraca wyłącznie pola statusowe (bez szczegółów promptu ani payloadu odpowiedzi AI).

## 2. Szczegóły żądania

- **Metoda HTTP:** GET
- **Struktura URL:** `/api/generation-batches/:id`
- **Parametry:**
  - Wymagane: `id` (path param) — UUID partii generacji
  - Opcjonalne: brak
- **Request Body:** brak

## 3. Wykorzystywane typy

### Nowy typ do dodania w `src/types.ts`

```ts
/**
 * Response for GET /api/generation-batches/:id — status-only poll payload.
 * Subset of GenerationBatchDTO exposing only the fields relevant to polling.
 */
export type GenerationBatchStatusDTO = Pick<
  Tables<"generation_batches">,
  | "id"
  | "status"
  | "returned_questions_count"
  | "retry_count"
  | "estimated_cost_usd"
  | "error_message"
  | "finished_at"
>;
```

### Istniejący typ pomocniczy

- `GenerationBatchDTO` z `src/types.ts` — bazowy typ partii (nie używany bezpośrednio w tej odpowiedzi, ale stanowi źródło prawdy)

## 4. Szczegóły odpowiedzi

### 200 OK

```json
{
  "id": "uuid",
  "status": "success | pending | failed",
  "returned_questions_count": 40,
  "retry_count": 1,
  "estimated_cost_usd": 0.012345,
  "error_message": null,
  "finished_at": "2026-03-21T10:00:28Z"
}
```

### Kody statusu

| Kod | Sytuacja |
|-----|----------|
| 200 | Partia znaleziona i należy do użytkownika |
| 400 | `id` nie jest prawidłowym UUID |
| 401 | Użytkownik niezalogowany |
| 404 | Partia nie istnieje lub należy do innego użytkownika |
| 500 | Błąd po stronie serwera (Supabase) |

## 5. Przepływ danych

```
Klient → GET /api/generation-batches/:id
  → Astro route handler (src/pages/api/generation-batches/[id].ts)
    1. Walidacja Zod: params.id musi być UUID
    2. Sprawdzenie auth: locals.user (lub TEST_USER_ID)
    3. Wywołanie serwisu: getGenerationBatchById(supabase, id, userId)
      → Supabase query:
          SELECT id, status, returned_questions_count, retry_count,
                 estimated_cost_usd, error_message, finished_at
          FROM generation_batches
          WHERE id = :id AND user_id = :userId
          LIMIT 1
      → Brak wyniku → throw NotFoundError
      → Wynik → return GenerationBatchStatusDTO
    4. Serialization → JSON Response 200
```

## 6. Względy bezpieczeństwa

- **Autentykacja:** Weryfikacja `locals.user` (ustawiana przez middleware `src/middleware.ts`). Brak użytkownika → 401. *(Tymczasowo wyłączone przez TEST_USER_ID — przywrócić przed produkcją.)*
- **Autoryzacja / IDOR:** Filtr `user_id = :userId` w zapytaniu Supabase zapobiega odczytowi cudzych partii. Nieznaleziony rekord zwraca 404 (nie 403), aby nie ujawniać istnienia zasobu.
- **Walidacja wejścia:** Zod UUID check na `params.id` — odrzuca ciągi niebędące UUID przed dotarciem do bazy.
- **RLS Supabase:** Tabela `generation_batches` powinna mieć politykę RLS: `SELECT` dozwolony tylko gdy `user_id = auth.uid()`. Stanowi drugą linię obrony nawet jeśli serwis nie filtruje.
- **Brak ujawniania wewnętrznych błędów:** Wiadomość błędu 500 jest generyczna; szczegóły logowane wyłącznie po stronie serwera.

## 7. Obsługa błędów

| Scenariusz | Klasa błędu | Kod HTTP | Treść odpowiedzi |
|-----------|-------------|----------|-----------------|
| `params.id` nie jest UUID | (Zod) | 400 | `{ "error": "Validation failed", "issues": [...] }` |
| Brak sesji użytkownika | — | 401 | `{ "error": "Unauthorized" }` |
| Partia nie istnieje lub należy do innego użytkownika | `NotFoundError` | 404 | `{ "error": "Generation batch not found" }` |
| Błąd Supabase (sieć, timeout) | — | 500 | `{ "error": "Internal server error" }` |

## 8. Rozważania dotyczące wydajności

- **Indeks:** Upewnić się, że `generation_batches(id, user_id)` ma indeks złożony — zapytanie jest point-lookup i powinno wykonywać się w < 5 ms.
- **SELECT tylko potrzebnych kolumn:** Serwis pobiera wyłącznie 7 pól (nie `*`), co redukuje payload z bazy.
- **Brak cache'owania:** Endpoint służy do pollingu — odpowiedzi nie powinny być cachowane (`Cache-Control: no-store`).

## 9. Etapy wdrożenia

1. **Dodaj `GenerationBatchStatusDTO` do `src/types.ts`** — nowy `Pick<Tables<"generation_batches">, ...>` dla pól statusowych.

2. **Dodaj metodę serwisową `getGenerationBatchById` w `src/lib/services/generation-batch.service.ts`:**
   - Sygnatura: `async function getGenerationBatchById(supabase: SupabaseClientType, id: string, userId: string): Promise<GenerationBatchStatusDTO>`
   - Query: `.from("generation_batches").select("id, status, returned_questions_count, retry_count, estimated_cost_usd, error_message, finished_at").eq("id", id).eq("user_id", userId).single()`
   - Jeśli `data === null` lub błąd `PGRST116` → `throw new NotFoundError("Generation batch not found")`
   - Logowanie błędów Supabase przed rzuceniem wyjątku

3. **Utwórz plik `src/pages/api/generation-batches/[id].ts`:**
   - `export const prerender = false`
   - Zdefiniuj `ParamsSchema = z.object({ id: z.string().uuid() })`
   - Eksportuj `GET: APIRoute`:
     - Parsuj `params` przez `ParamsSchema.safeParse`
     - Sprawdź `locals.user` → 401 jeśli brak (zachowaj TEST_USER_ID dla środowiska dev)
     - Wywołaj `getGenerationBatchById(locals.supabase, id, userId)`
     - Zwróć `Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })`
     - Catch `NotFoundError` → 404
     - Catch reszta → `console.error` + 500

4. **Weryfikacja typów i lint:** Uruchom `npm run lint` i popraw ewentualne błędy.

5. **Test manualny / curl:** Sprawdź scenariusze: istniejące ID, nieistniejące ID, nieprawidłowy format UUID.
