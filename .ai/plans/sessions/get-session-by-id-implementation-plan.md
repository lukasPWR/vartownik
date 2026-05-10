# API Endpoint Implementation Plan: GET /api/sessions/:id

## 1. Przegląd punktu końcowego

Endpoint zwraca pełne szczegóły pojedynczej sesji treningowej należącej do zalogowanego użytkownika. Odpowiedź obejmuje wszystkie pola sesji, podsumowanie wyników (`score_summary` wyliczone z attemptów) oraz skróconą listę rund (`rounds`). Dostęp do cudzej sesji lub nieistniejącego zasobu skutkuje `404 Not Found`.

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/sessions/:id`
- **Parametry:**
  - Wymagane: `id` (path param) — UUID sesji
  - Opcjonalne: brak
- **Request Body:** brak

## 3. Wykorzystywane typy

Wszystkie typy już istnieją w `src/types.ts` — nie trzeba ich dodawać.

```ts
/** Wyliczane po stronie serwera z tabeli attempts */
interface ScoreSummaryDTO {
  total_questions: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number;
}

/** Slim DTO każdej rundy sesji */
type RoundSummaryDTO = Pick<Tables<"rounds">, "id" | "position" | "status">;

/** Response body dla GET /api/sessions/:id → 200 */
interface SessionDetailDTO {
  id: string;
  status: SessionStatus;
  timer_seconds: number;
  total_rounds: number;
  questions_per_round: number;
  generation_batch_id: string | null;
  started_at: string;
  completed_at: string | null;
  abandoned_at: string | null;
  score_summary: ScoreSummaryDTO;
  rounds: RoundSummaryDTO[];
}
```

## 4. Szczegóły odpowiedzi

| Status | Opis |
|--------|------|
| `200 OK` | Sesja znaleziona; zwracany `SessionDetailDTO` |
| `400 Bad Request` | `id` nie jest poprawnym UUID |
| `401 Unauthorized` | Użytkownik niezalogowany |
| `404 Not Found` | Sesja nie istnieje lub należy do innego użytkownika |
| `500 Internal Server Error` | Nieoczekiwany błąd po stronie serwera |

**Body odpowiedzi 200:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "timer_seconds": 20,
  "total_rounds": 4,
  "questions_per_round": 10,
  "generation_batch_id": "550e8400-e29b-41d4-a716-446655440001",
  "started_at": "2026-05-10T10:00:00Z",
  "completed_at": "2026-05-10T10:15:00Z",
  "abandoned_at": null,
  "score_summary": {
    "total_questions": 40,
    "knew_count": 30,
    "did_not_know_count": 8,
    "accuracy_percent": 78.9
  },
  "rounds": [
    { "id": "uuid-1", "position": 1, "status": "completed" },
    { "id": "uuid-2", "position": 2, "status": "completed" },
    { "id": "uuid-3", "position": 3, "status": "completed" },
    { "id": "uuid-4", "position": 4, "status": "completed" }
  ]
}
```

## 5. Przepływ danych

```
Klient
  │
  ▼
GET /api/sessions/:id   (src/pages/api/sessions/[id].ts)
  │
  ├─ 1. Sprawdź locals.user → 401 jeśli brak
  ├─ 2. Waliduj path param id (Zod uuid) → 400 jeśli niepoprawny
  │
  ▼
getSessionById(supabase, id, userId)   (src/lib/services/sessions.service.ts)
  │
  ├─ 3. Zapytanie do Supabase:
  │      sessions
  │        .select(`
  │          id, status, timer_seconds, total_rounds, questions_per_round,
  │          generation_batch_id, started_at, completed_at, abandoned_at,
  │          rounds(id, position, status,
  │            attempts(verdict)
  │          )
  │        `)
  │        .eq("id", id)
  │        .single()
  │      RLS automatycznie filtruje do sesji zalogowanego użytkownika
  │
  ├─ 4. Jeśli brak wyników (PGRST116 / null) → rzuć NotFoundError → 404
  │
  ├─ 5. Wylicz score_summary z zagnieżdżonych attemptów:
  │      - Spłaszcz attempts ze wszystkich rund
  │      - Zlicz knew / did_not_know / total
  │      - accuracy_percent = round(knew / (knew + did_not_know) * 1000) / 10
  │        (0 gdy brak ocenionych attemptów)
  │
  ├─ 6. Zmapuj rounds → RoundSummaryDTO[] (id, position, status)
  │
  └─ 7. Złóż i zwróć SessionDetailDTO → 200
```

## 6. Względy bezpieczeństwa

- **Uwierzytelnianie:** sprawdzenie `locals.user` jako pierwsze działanie w handlerze; brak sesji → `401`.
- **Autoryzacja przez RLS:** tabela `sessions` posiada politykę `user_id = auth.uid()`. Supabase automatycznie filtruje wyniki do danych zalogowanego użytkownika — próba odczytu cudzej sesji zwraca pusty wynik (obsługiwany jako `404`), a nie błąd autoryzacji. Nie ujawnia to faktu istnienia zasobu.
- **Walidacja path param:** UUID weryfikowany przez `z.string().uuid()` — uniemożliwia przekazanie złośliwych wartości do zapytania.
- **Brak `user_id` w odpowiedzi:** pole `user_id` z tabeli `sessions` nie jest uwzględniane w `SessionDetailDTO`.
- **Brak wrażliwych danych:** endpoint nie zwraca pól `correct_answer` ani żadnych danych innych użytkowników.
- **Klient Supabase z `locals`:** zgodnie z wytycznymi — używamy klienta z `context.locals`, który korzysta z cookies sesji użytkownika.

## 7. Obsługa błędów

| Scenariusz | Kod | Treść odpowiedzi |
|---|---|---|
| Brak zalogowanego użytkownika | `401` | `{ "error": "Unauthorized" }` |
| `id` nie jest UUID | `400` | `{ "error": "Validation failed", "issues": [...] }` |
| Sesja nie istnieje / cudza | `404` | `{ "error": "Session not found" }` |
| Błąd Supabase / sieciowy | `500` | `{ "error": "Internal server error" }` |

Wewnątrz serwisu:
- `NotFoundError` z `src/lib/errors.ts` mapuje się na `404`.
- Wszelkie inne wyjątki logowane przez `console.error("[GET /api/sessions/:id]", err)` i mapowane na `500`.

## 8. Rozważania dotyczące wydajności

- **Pojedyncze zapytanie z nested select:** jedno wywołanie Supabase pobiera sesję, rundy oraz attempts dzięki PostgREST nested relations — brak problemu N+1.
- **Indeksy:** tabela `rounds` powinna posiadać indeks na `session_id` (weryfikacja w migracjach); tabela `attempts` — indeks na `round_id`.
- **Brak paginacji:** endpoint zwraca jedną sesję; zagnieżdżone rundy (max 4) i attempts (max 40) są niewielkim ładunkiem — dodatkowa paginacja jest zbędna.
- **RLS nie wymaga dodatkowych filtrów:** klient Supabase używa tokena sesji, RLS działa na poziomie bazy.

## 9. Etapy wdrożenia

1. **Utwórz serwis `src/lib/services/sessions.service.ts`** z funkcją:
   ```ts
   export async function getSessionById(
     supabase: SupabaseClientType,
     sessionId: string
   ): Promise<SessionDetailDTO>
   ```
   Funkcja wykonuje jeden nested select, wylicza `score_summary`, mapuje `rounds` do `RoundSummaryDTO[]` i rzuca `NotFoundError` gdy brak wyników.

2. **Utwórz plik `src/pages/api/sessions/[id].ts`** z handlerem `GET`:
   - Eksportuj `export const prerender = false`.
   - Sprawdź `locals.user` → `401`.
   - Waliduj `Astro.params.id` schematem Zod `z.string().uuid()` → `400`.
   - Wywołaj `getSessionById(locals.supabase, id)`.
   - Obsłuż `NotFoundError` → `404`.
   - Obsłuż pozostałe wyjątki → `500`.
   - Przy powodzeniu zwróć `JSON.stringify(result)` ze statusem `200`.

3. **Sprawdź istniejące typy** w `src/types.ts` (`SessionDetailDTO`, `RoundSummaryDTO`, `ScoreSummaryDTO`) — upewnij się, że obejmują pola `abandoned_at` i `generation_batch_id` (już są).

4. **Uruchom linter** (`npm run lint`) i popraw ewentualne błędy.

5. **Przetestuj manualnie** endpoint (np. przez curl lub REST Client):
   - `GET /api/sessions/:id` z poprawnym tokenem i istniejącym id → `200`.
   - `GET /api/sessions/:id` z niezalogowanym użytkownikiem → `401`.
   - `GET /api/sessions/not-a-uuid` → `400`.
   - `GET /api/sessions/nonexistent-uuid` → `404`.
