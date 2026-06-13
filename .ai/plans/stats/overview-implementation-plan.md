# API Endpoint Implementation Plan: GET /api/stats/overview

## 1. Przegląd punktu końcowego

Endpoint zwraca zbiorczy przegląd wydajności zalogowanego użytkownika na potrzeby widoku dashboardu (US-006). Agreguje dane z tabel `attempts`, `sessions` i `questions`, obliczając m.in. łączną liczbę prób, trafność odpowiedzi oraz liczbę oczekujących zgłoszeń do weryfikacji.

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/stats/overview`
- **Parametry:**
  - Wymagane: brak
  - Opcjonalne: brak
- **Request Body:** brak
- **Uwierzytelnienie:** wymagane — sesja cookie zarządzana przez Supabase SSR (`locals.user`)

## 3. Wykorzystywane typy

```ts
// src/types.ts
export interface StatsOverviewDTO {
  total_attempts: number;
  knew_count: number;
  did_not_know_count: number;
  overall_accuracy_percent: number; // zaokrąglone do 1 miejsca po przecinku
  total_sessions_completed: number;
  flagged_questions_pending: number;
}
```

Brak Command Modeli — endpoint jest tylko do odczytu.

## 4. Szczegóły odpowiedzi

### `200 OK`

```json
{
  "total_attempts": 1240,
  "knew_count": 867,
  "did_not_know_count": 373,
  "overall_accuracy_percent": 69.9,
  "total_sessions_completed": 31,
  "flagged_questions_pending": 4
}
```

`Content-Type: application/json`

### Kody statusu

| Kod | Sytuacja |
|-----|----------|
| `200` | Dane pobrane pomyślnie |
| `401` | Brak sesji / niezalogowany użytkownik |
| `500` | Błąd serwera (np. zapytanie do Supabase nie powiodło się) |

## 5. Przepływ danych

```
Klient → GET /api/stats/overview
  → Middleware (Astro): weryfikacja sesji → locals.user
  → Route handler: sprawdzenie locals.user (401 jeśli brak)
  → StatsService.getStatsOverview(supabase, userId)
      ↓ (równoległe zapytania do Supabase)
      ├── attempts: COUNT gdzie user_id = userId                  → total_attempts
      ├── attempts: COUNT gdzie user_id = userId AND verdict = 'knew'         → knew_count
      ├── attempts: COUNT gdzie user_id = userId AND verdict = 'did_not_know' → did_not_know_count
      ├── sessions: COUNT gdzie user_id = userId AND status = 'completed'     → total_sessions_completed
      └── questions: COUNT gdzie user_id = userId AND status = 'flagged'      → flagged_questions_pending
      ↓
      overall_accuracy_percent = round((knew / (knew + did_not_know)) * 100, 1)
  → Route handler: serializacja do JSON → Response 200
```

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie:** Każde żądanie musi zawierać ważną sesję cookie. Middleware Astro (`src/middleware.ts`) weryfikuje sesję i ustawia `locals.user`. Route handler musi odrzucić żądanie z `401`, gdy `locals.user` jest `null`.

2. **Autoryzacja (scoping):** Każde zapytanie do bazy danych filtrowane jest klauzulą `.eq("user_id", userId)` — użytkownik widzi wyłącznie własne dane.

3. **Row Level Security (RLS):** Tabele `attempts`, `sessions` i `questions` muszą mieć włączone RLS z politykami `SELECT` ograniczonymi do `auth.uid() = user_id`. Jest to druga linia obrony.

4. **Brak danych wejściowych od użytkownika:** Endpoint nie przyjmuje żadnych parametrów, więc ryzyko SQL injection czy XSS nie dotyczy warstwy aplikacji.

5. **Supabase client:** Zawsze używać `locals.supabase` (client SSR) — nigdy nie importować `supabaseClient` bezpośrednio w plikach route.

## 7. Obsługa błędów

| Scenariusz | Kod | Treść odpowiedzi |
|------------|-----|-----------------|
| `locals.user` jest `null` | `401` | `{ "error": "Unauthorized" }` |
| Dowolne zapytanie Supabase zwróci błąd | `500` | `{ "error": "Internal server error" }` |
| Nieoczekiwany wyjątek w handlerze | `500` | `{ "error": "Internal server error" }` |

Błędy serwera są logowane przez `console.error("[GET /api/stats/overview]", err)` przed zwróceniem odpowiedzi `500`.

Gdy żaden wynik nie istnieje (nowy użytkownik), wszystkie pola przyjmują wartość `0`, a `overall_accuracy_percent` wynosi `0` (edge case: dzielenie przez zero).

## 8. Rozważania dotyczące wydajności

1. **Równoległe zapytania:** Wszystkie 5 zapytań COUNT wykonywane jednocześnie przez `Promise.all(...)` — minimalizuje czas oczekiwania do najwolniejszego zapytania.

2. **HEAD queries (`{ count: "exact", head: true }`):** Supabase zwraca tylko liczbę wierszy bez pobierania danych — minimalne obciążenie sieci i parsowania.

3. **Indeksy bazy danych:** Dla optymalnej wydajności zalecane indeksy:
   - `attempts(user_id)` — dla wszystkich trzech zapytań na tabeli `attempts`
   - `attempts(user_id, verdict)` — dla filtrowania po werdykcie
   - `sessions(user_id, status)` — dla filtrowania po statusie sesji
   - `questions(user_id, status)` — dla filtrowania po statusie pytania

4. **Brak paginacji:** Endpoint zwraca jeden skalarny obiekt — brak ryzyka przepełnienia pamięci.

## 9. Etapy wdrożenia

1. **Dodać `StatsOverviewDTO` do `src/types.ts`** (sekcja Stats):
   ```ts
   export interface StatsOverviewDTO {
     total_attempts: number;
     knew_count: number;
     did_not_know_count: number;
     overall_accuracy_percent: number;
     total_sessions_completed: number;
     flagged_questions_pending: number;
   }
   ```

2. **Utworzyć `src/lib/services/stats.service.ts`** z funkcją:
   ```ts
   export async function getStatsOverview(
     supabase: SupabaseClient,
     userId: string
   ): Promise<StatsOverviewDTO>
   ```
   - Wykonać 5 równoległych zapytań COUNT przez `Promise.all`
   - Rzucić wyjątek, jeśli którekolwiek zapytanie zwróci błąd
   - Obliczyć `overall_accuracy_percent` z obsługą edge case (dzielenie przez zero)
   - Zwrócić skonstruowany obiekt `StatsOverviewDTO`

3. **Utworzyć `src/pages/api/stats/overview.ts`** jako route handler:
   - Wyeksportować `export const prerender = false`
   - Wyeksportować `export const GET: APIRoute`
   - Sprawdzić `locals.user` → `401` jeśli brak
   - Wywołać `getStatsOverview(locals.supabase, locals.user.id)`
   - Zwrócić `Response` z JSON i statusem `200`
   - Obsłużyć wyjątki przez `try/catch` → `500` + logowanie

4. **Weryfikacja RLS w Supabase:** Upewnić się, że tabele `attempts`, `sessions` i `questions` mają polityki RLS `SELECT` ograniczone do właściciela wiersza (`auth.uid() = user_id`).

5. **Dodać indeksy bazodanowe** (jeśli nie istnieją) w nowej migracji `supabase/migrations/`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_attempts_user_verdict ON attempts(user_id, verdict);
   CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status);
   CREATE INDEX IF NOT EXISTS idx_questions_user_status ON questions(user_id, status);
   ```

6. **Przetestować manualnie** przez `curl` lub Postman:
   - Bez sesji → oczekiwany `401`
   - Z sesją użytkownika bez danych → `200` z samymi zerami
   - Z sesją użytkownika z danymi → `200` z poprawnymi wartościami
