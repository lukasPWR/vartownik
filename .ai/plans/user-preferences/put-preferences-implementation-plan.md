# API Endpoint Implementation Plan: PUT /api/user/preferences

## 1. Przegląd punktu końcowego

Endpoint umożliwia zalogowanemu użytkownikowi upsert (utworzenie lub aktualizację) jego preferencji aplikacji. Obsługuje m.in. domyślny czas trwania timera w grze oraz wagi kategorii pytań. Operacja jest idempotentna — wielokrotne wywołanie z tymi samymi danymi zwraca ten sam wynik.

## 2. Szczegóły żądania

- **Metoda HTTP:** `PUT`
- **Struktura URL:** `/api/user/preferences`
- **Parametry:**
  - Wymagane: brak parametrów URL / query string
  - Opcjonalne: brak
- **Request Body (application/json):**

```json
{
  "default_timer_seconds": 25,
  "category_weights": {
    "ekstraklasa": 0.4,
    "historia-ms-euro": 0.2,
    "statystyki": 0.15,
    "pilka-zagraniczna": 0.15,
    "reprezentacja-polski": 0.1
  }
}
```

| Pole | Typ | Wymagane | Walidacja |
|---|---|---|---|
| `default_timer_seconds` | `integer` | tak | zakres [15, 30] |
| `category_weights` | `object` | tak | musi być obiektem JSON (string → number) |

## 3. Wykorzystywane typy

Dodać do `src/types.ts`:

```ts
// ---------------------------------------------------------------------------
// 5. User Preferences
// ---------------------------------------------------------------------------

/** PUT /api/user/preferences request body. */
export interface UpsertUserPreferencesCommand {
  default_timer_seconds: number;
  category_weights: Record<string, number>;
}

/** Response DTO for GET/PUT /api/user/preferences. */
export type UserPreferencesDTO = Pick<
  Tables<"user_preferences">,
  "user_id" | "default_timer_seconds" | "category_weights" | "storage_limit_images_bytes" | "storage_limit_questions" | "created_at" | "updated_at"
>;
```

## 4. Szczegóły odpowiedzi

### 200 OK — pomyślny upsert

```json
{
  "user_id": "uuid",
  "default_timer_seconds": 25,
  "category_weights": {
    "ekstraklasa": 0.4,
    "historia-ms-euro": 0.2,
    "statystyki": 0.15,
    "pilka-zagraniczna": 0.15,
    "reprezentacja-polski": 0.1
  },
  "storage_limit_images_bytes": 104857600,
  "storage_limit_questions": 500,
  "created_at": "2026-05-10T12:00:00Z",
  "updated_at": "2026-05-10T12:05:00Z"
}
```

### Kody statusów

| Kod | Scenariusz |
|---|---|
| `200` | Upsert zakończony sukcesem |
| `400` | Nieprawidłowe dane wejściowe (błąd walidacji Zod) |
| `401` | Brak uwierzytelnienia |
| `500` | Wewnętrzny błąd serwera (błąd Supabase) |

## 5. Przepływ danych

```
Klient
  │
  │  PUT /api/user/preferences  { body }
  ▼
src/pages/api/user/preferences.ts   (Astro API route)
  │
  ├─ 1. Odczyt context.locals.user — brak → 401
  │
  ├─ 2. Parsowanie body (Astro APIContext.request.json())
  │
  ├─ 3. Walidacja Zod (UpsertUserPreferencesBodySchema)
  │      └─ błąd → 400 { error, details }
  │
  ├─ 4. Wywołanie preferencesService.upsertUserPreferences(supabase, user.id, command)
  │      └─ błąd Supabase → 500 { error }
  │
  └─ 5. Zwrócenie 200 { UserPreferencesDTO }
```

### Interakcja z bazą danych

Supabase `upsert` na tabeli `user_preferences` z kluczem konfliktu `user_id` i opcją `onConflict: "user_id"`. RLS automatycznie ogranicza operację do wiersza zalogowanego użytkownika.

```ts
const { data, error } = await supabase
  .from("user_preferences")
  .upsert(
    {
      user_id: userId,
      default_timer_seconds: command.default_timer_seconds,
      category_weights: command.category_weights,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )
  .select()
  .single();
```

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie** — `context.locals.user` jest ustawiane przez middleware (`src/middleware.ts`). Trasa `/api/user/preferences` musi być na liście `PROTECTED_ROUTES`; w razie braku sesji middleware zwraca przekierowanie zanim request dotrze do handlera. Handler defensywnie sprawdza też `locals.user` i zwraca `401` jeśli jest `null/undefined`.

2. **Autoryzacja / izolacja danych** — `user_id` jest zawsze pobierany z `context.locals.user.id` (serwer-side, weryfikowany JWT). Nigdy nie jest przyjmowany z body żądania — zapobiega to atakowi polegającemu na nadpisaniu preferencji innego użytkownika.

3. **RLS (Row Level Security)** — tabela `user_preferences` powinna mieć polityki RLS:
   - `SELECT` — `auth.uid() = user_id`
   - `INSERT` — `auth.uid() = user_id`
   - `UPDATE` — `auth.uid() = user_id`

4. **Walidacja wejścia** — schemat Zod odrzuca:
   - `default_timer_seconds` spoza zakresu [15, 30]
   - `category_weights` nie będący obiektem `Record<string, number>`
   - Zapobiega to wstrzyknięciu złośliwych danych do kolumny `Json` w bazie.

5. **Brak wrażliwych danych w odpowiedzi** — DTO nie ujawnia wewnętrznych pól jak klucze serwisowe; nie zwraca nieistotnych kolumn.

## 7. Obsługa błędów

| Scenariusz | Kod | Treść odpowiedzi |
|---|---|---|
| `locals.user` brak | `401` | `{ "error": "Unauthorized" }` |
| Nieprawidłowy JSON w body | `400` | `{ "error": "Invalid request body" }` |
| Walidacja Zod — `default_timer_seconds` | `400` | `{ "error": "Validation failed", "details": [...] }` |
| Walidacja Zod — `category_weights` | `400` | `{ "error": "Validation failed", "details": [...] }` |
| Błąd Supabase (upsert) | `500` | `{ "error": "Internal server error" }` |

Błędy Supabase są logowane po stronie serwera przez `console.error` przed zwróceniem odpowiedzi 500 (szczegóły błędu nie są ujawniane klientowi).

## 8. Rozważania dotyczące wydajności

- **Pojedyncza operacja DB** — jedno wywołanie `.upsert().select().single()` łączy zapis i odczyt zaktualizowanego wiersza w jednym round-tripie do Supabase.
- **Brak zbędnych zapytań** — nie ma osobnego `SELECT` przed upsert; Postgres obsługuje logikę INSERT OR UPDATE natywnie.
- **Indeks** — kolumna `user_id` jest kluczem głównym tabeli `user_preferences` (zakładane), więc upsert po konflikcie na `user_id` jest O(log n).
- **Brak cachowania** — preferencje zmieniają się rzadko, jednak ze względu na SSR i osobisty charakter danych nie stosuje się cachowania po stronie serwera; odpowiedź nie jest cachowana przez CDN (brak nagłówka `Cache-Control`).

## 9. Etapy wdrożenia

1. **Dodanie typów do `src/types.ts`** — `UpsertUserPreferencesCommand` i `UserPreferencesDTO` zgodnie z sekcją 3.

2. **Weryfikacja RLS** — sprawdzenie w `supabase/migrations/` czy tabela `user_preferences` ma polityki RLS dla operacji `SELECT`, `INSERT`, `UPDATE`; w razie potrzeby dodanie nowej migracji (`YYYYMMDDHHmmss_user_preferences_rls.sql`).

3. **Dodanie trasy do `PROTECTED_ROUTES`** — upewnienie się, że `/api/user/preferences` jest chroniona przez middleware w `src/middleware.ts`.

4. **Stworzenie serwisu `src/lib/services/preferences.service.ts`:**
   - Zod schema: `UpsertUserPreferencesBodySchema`
   - Funkcja `upsertUserPreferences(supabase: SupabaseClientType, userId: string, command: UpsertUserPreferencesCommand): Promise<UserPreferencesDTO>`
   - Wywołanie `.upsert({ user_id, ...command, updated_at }, { onConflict: "user_id" }).select().single()`
   - Rzucenie błędu gdy Supabase zwróci `error`

5. **Stworzenie endpointu `src/pages/api/user/preferences.ts`:**
   - `export const prerender = false`
   - Export `PUT` handler
   - Sprawdzenie `context.locals.user` → 401 jeśli brak
   - Parsowanie body (`request.json()`) w bloku try/catch → 400 jeśli niepoprawny JSON
   - Walidacja Zod → 400 z `details` jeśli błąd
   - Wywołanie serwisu → 500 z logowaniem jeśli błąd
   - Zwrócenie `new Response(JSON.stringify(dto), { status: 200, headers: { "Content-Type": "application/json" } })`

6. **Testy manualne (happy path + edge cases):**
   - Upsert z poprawnymi danymi → 200
   - `default_timer_seconds: 14` → 400
   - `default_timer_seconds: 31` → 400
   - `category_weights: "string"` → 400
   - Brak tokenu sesji → 401
