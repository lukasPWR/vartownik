# API Endpoint Implementation Plan: GET /api/stats/categories

## 1. Przegląd punktu końcowego

Endpoint zwraca zestawienie skuteczności nauki w rozbiciu na kategorie pytań dla uwierzytelnionego użytkownika. Dane są agregowane z tabeli `category_stats_daily` (codzienne snapshoty prób) i łączone z tabelą `categories` w celu uzyskania nazwy kategorii. Wynik zawiera liczniki prób, trafień i pudłów oraz wyliczony procent trafności dla każdej kategorii, w zadanym przedziale dat.

Spełnia wymaganie US-006.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/stats/categories`
- **Parametry:**
  - Wymagane: _brak_
  - Opcjonalne:
    - `from` — data początkowa zakresu (format `YYYY-MM-DD`); domyślnie: 30 dni temu (obliczane w handlerze)
    - `to` — data końcowa zakresu (format `YYYY-MM-DD`); domyślnie: dzisiaj (obliczane w handlerze)
- **Request Body:** nie dotyczy (GET)

---

## 3. Wykorzystywane typy

Wszystkie typy są zdefiniowane w `src/types.ts`. Żadnych nowych typów nie trzeba tworzyć.

```ts
/** Pojedynczy wiersz wyniku — jedna kategoria. */
interface CategoryStatsDTO {
  category_id: string;
  category_name: string;
  attempts_count: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number; // zaokrąglone do 1 miejsca dziesiętnego
}

/** Koperta odpowiedzi 200. */
interface CategoryStatsResponseDTO {
  data: CategoryStatsDTO[];
}

/** Alias używany przez komponenty dashboardu — identyczny kształt jak CategoryStatsDTO. */
type CategoryStatsItemDTO = CategoryStatsDTO;
```

**Schemat walidacji Zod** (definiowany w serwisie lub handlerze):

```ts
const CategoryStatsQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD")
    .optional(),
});
```

---

## 4. Szczegóły odpowiedzi

| Status | Kiedy                                                   | Body                                              |
|--------|---------------------------------------------------------|---------------------------------------------------|
| 200    | Sukces                                                  | `CategoryStatsResponseDTO`                        |
| 400    | Nieprawidłowy format daty lub `from` > `to`             | `{ error: string, issues?: ValidationIssue[] }`   |
| 401    | Brak lub wygasła sesja użytkownika                      | `{ error: "Unauthorized" }`                       |
| 500    | Błąd po stronie serwera (np. błąd Supabase)             | `{ error: "Internal server error" }`              |

**Przykładowa odpowiedź 200:**

```json
{
  "data": [
    {
      "category_id": "uuid",
      "category_name": "Ekstraklasa",
      "attempts_count": 320,
      "knew_count": 210,
      "did_not_know_count": 110,
      "accuracy_percent": 65.6
    }
  ]
}
```

Jeśli użytkownik nie ma żadnych danych w podanym zakresie, zwracana jest pusta tablica: `{ "data": [] }`.

---

## 5. Przepływ danych

```
Klient
  │  GET /api/stats/categories?from=2026-03-01&to=2026-04-30
  ▼
src/pages/api/stats/categories.ts  (Astro API Route)
  │  1. Sprawdź locals.user → 401 jeśli brak
  │  2. Parsuj searchParams; waliduj przez CategoryStatsQuerySchema → 400 jeśli błąd
  │  3. Walidacja logiczna: from <= to → 400 jeśli błąd
  │  4. Wyznacz domyślne wartości (from = today-30d, to = today)
  │  5. Wywołaj getCategoryStats(supabase, userId, from, to)
  ▼
src/lib/services/stats.service.ts  (nowy serwis)
  │  6. Zapytanie do Supabase:
  │     category_stats_daily (filtr: user_id, stat_date BETWEEN from AND to)
  │       JOIN categories (name)
  │  7. Agregacja wierszy dziennych per category_id w pamięci
  │  8. Oblicz accuracy_percent = round((knew / attempts) * 100, 1)
  │  9. Zwróć CategoryStatsDTO[]
  ▼
src/pages/api/stats/categories.ts
  │  10. Owiń w CategoryStatsResponseDTO
  │  11. Zwróć Response 200 z JSON
  ▼
Klient
```

### Szczegóły zapytania do bazy

```sql
SELECT
  csd.category_id,
  c.name AS category_name,
  SUM(csd.knew_count)         AS knew_count,
  SUM(csd.did_not_know_count) AS did_not_know_count,
  SUM(csd.attempts_count)     AS attempts_count
FROM category_stats_daily csd
JOIN categories c ON c.id = csd.category_id
WHERE csd.user_id = :userId
  AND csd.stat_date >= :from
  AND csd.stat_date <= :to
GROUP BY csd.category_id, c.name;
```

Supabase SDK odpowiednik:
```ts
const { data, error } = await supabase
  .from("category_stats_daily")
  .select("category_id, knew_count, did_not_know_count, attempts_count, categories(name)")
  .eq("user_id", userId)
  .gte("stat_date", from)
  .lte("stat_date", to);
```

Po stronie serwisu agregacja w pamięci (iteracja przez `data`) zamiast GROUP BY jest dopuszczalna przy umiarkowanym wolumenie danych. Dla dużych zbiorów zalecane przejście na widok bazodanowy lub RPC (patrz sekcja 7).

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie:** Każde żądanie wymaga aktywnej sesji. Guard `if (!locals.user) → 401` jest pierwszą instrukcją handlera. Supabase używa `context.locals.supabase` (klient SSR z cookies) — nigdy bezpośredniego importu klienta w route.

2. **Autoryzacja / izolacja danych:**
   - RLS na tabeli `category_stats_daily` ogranicza wiersze do `auth.uid() = user_id`.
   - Dodatkowo stosowana jest jawna klauzula `.eq("user_id", userId)` jako defense-in-depth.

3. **Walidacja danych wejściowych:**
   - Parametry `from` i `to` są walidowane ścisłym wyrażeniem regularnym `/^\d{4}-\d{2}-\d{2}$/` — bez możliwości wstrzyknięcia znaków specjalnych.
   - Supabase SDK używa zapytań parametryzowanych — brak ryzyka SQL Injection.
   - Walidacja logiczna: `from > to` zwraca 400.

4. **Brak ujawniania szczegółów błędów:** Błędy serwera są logowane przez `console.error`, a klientowi zwracany jest jedynie ogólny komunikat `"Internal server error"`.

---

## 7. Obsługa błędów

| Scenariusz                                     | Kod | Odpowiedź                                                                    |
|------------------------------------------------|-----|------------------------------------------------------------------------------|
| Brak/wygasła sesja (`locals.user` jest null)   | 401 | `{ "error": "Unauthorized" }`                                                |
| Nieprawidłowy format `from` lub `to`           | 400 | `{ "error": "Validation failed", "issues": [{ "path": "from", "message": "..." }] }` |
| `from` jest późniejsze niż `to`                | 400 | `{ "error": "Validation failed", "issues": [{ "path": "from", "message": "'from' must not be later than 'to'" }] }` |
| Błąd Supabase (sieć, timeout, RLS)             | 500 | `{ "error": "Internal server error" }`                                       |

Błędy Supabase są przechwytywane przez blok `try/catch` i logowane w formacie:
```ts
console.error("[GET /api/stats/categories]", err);
```

---

## 8. Rozważania dotyczące wydajności

1. **Indeksy bazodanowe:** Upewnić się, że na tabeli `category_stats_daily` istnieje kompozytowy indeks `(user_id, stat_date)`. Pozwoli to na efektywne filtrowanie po użytkowniku i zakresie dat.

2. **Agregacja po stronie bazy vs. pamięci:**
   - Przy obecnym wolumenie (dzienna granularność × liczba kategorii × liczba użytkowników) agregacja w pamięci (TypeScript `Map`) jest wystarczająca.
   - W przyszłości — gdy `category_stats_daily` urośnie — zalecane jest stworzenie widoku PostgreSQL lub funkcji RPC (`get_category_stats(user_id, from, to)`) z `GROUP BY`, aby zredukować transfer danych.

3. **Brak paginacji:** Endpoint zwraca wszystkie kategorie naraz. Przy typowych założeniach (kilkadziesiąt kategorii na użytkownika) jest to bezpieczne. Brak konieczności paginacji.

4. **Caching:** Dane statystyczne są względnie statyczne w ciągu dnia. W przyszłości można rozważyć krótkotrwałe cache HTTP (`Cache-Control: max-age=300`) dla zalogowanego użytkownika.

---

## 9. Etapy wdrożenia

1. **Dodaj typy** (już gotowe — weryfikacja):
   - Potwierdź, że `CategoryStatsDTO`, `CategoryStatsResponseDTO` i `CategoryStatsItemDTO` są zdefiniowane w `src/types.ts`. ✓

2. **Utwórz serwis `src/lib/services/stats.service.ts`:**
   - Zdefiniuj i eksportuj `CategoryStatsQuerySchema` (Zod).
   - Zaimplementuj funkcję `getCategoryStats(supabase: SupabaseClientType, userId: string, from: string, to: string): Promise<CategoryStatsDTO[]>`:
     - Wykonaj zapytanie do `category_stats_daily` z join do `categories`.
     - Przeiteruj wyniki i zaagreguj wiersze dzienne w `Map<category_id, CategoryStatsDTO>`.
     - Oblicz `accuracy_percent = Math.round((knew / attempts) * 1000) / 10` (unikaj dzielenia przez 0).
     - Zwróć `Array.from(categoryMap.values())`.

3. **Zaktualizuj handler `src/pages/api/stats/categories.ts`:**
   - Dodaj `export const prerender = false`.
   - Importuj `CategoryStatsQuerySchema` i `getCategoryStats` z serwisu.
   - Guard uwierzytelnienia: `if (!locals.user) → 401`.
   - Parsuj `searchParams`, waliduj przez `CategoryStatsQuerySchema.safeParse(...)` → 400 jeśli błąd.
   - Walidacja logiczna `from > to` → 400.
   - Wyznacz domyślne daty (`from` = today−30d, `to` = today) gdy brak parametrów.
   - Wywołaj `getCategoryStats(locals.supabase, userId, from, to)` w bloku `try/catch`.
   - Zwróć `Response` 200 z `JSON.stringify({ data })` i nagłówkiem `Content-Type: application/json`.
   - W bloku `catch` — `console.error` + 500.

4. **Weryfikacja RLS:** Sprawdź, że na tabeli `category_stats_daily` obowiązuje polityka RLS:
   ```sql
   CREATE POLICY "Users see own stats" ON category_stats_daily
     FOR SELECT USING (auth.uid() = user_id);
   ```
   Jeśli brakuje — dodaj w nowej migracji.

5. **Weryfikacja indeksów:** Sprawdź, że istnieje indeks:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_category_stats_daily_user_date
     ON category_stats_daily (user_id, stat_date);
   ```
   Jeśli brakuje — dodaj w migracji.

6. **Uruchom linter i sprawdź błędy typów:**
   ```bash
   npm run lint
   ```
   Popraw wszystkie błędy ESLint/TypeScript przed commitowaniem.

7. **Manualne testy weryfikacyjne:**
   - `GET /api/stats/categories` bez sesji → oczekiwane 401.
   - `GET /api/stats/categories?from=invalid` → oczekiwane 400.
   - `GET /api/stats/categories?from=2026-05-01&to=2026-04-01` → oczekiwane 400.
   - `GET /api/stats/categories` (zalogowany, z danymi) → oczekiwane 200 z prawidłową strukturą.
   - `GET /api/stats/categories` (zalogowany, brak danych w zakresie) → oczekiwane 200 z `{ "data": [] }`.
