# API Endpoint Implementation Plan: GET /api/user/preferences

## 1. Przegląd punktu końcowego

Endpoint zwraca aktualne preferencje zalogowanego użytkownika: domyślny czas timera, wagi kategorii pytań oraz limity storage (pytania i obrazy). Dane są pobierane bezpośrednio z tabeli `user_preferences` — jeden wiersz na użytkownika. Endpoint jest tylko do odczytu i nie przyjmuje żadnych parametrów.

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/user/preferences`
- **Parametry:**
  - Wymagane: brak
  - Opcjonalne: brak
- **Request Body:** brak

## 3. Wykorzystywane typy

Już zdefiniowane w `src/types.ts` — nie wymagają zmian:

```ts
/** Category weights map: slug → weight (0.0–1.0). */
export type CategoryWeightsMap = Record<string, number>;

/** GET /api/user/preferences response. */
export interface UserPreferencesDTO {
  user_id: string;
  default_timer_seconds: number;
  category_weights: CategoryWeightsMap;
  storage_limit_questions: number;
  storage_limit_images_bytes: number;
  updated_at: string;
}
```

## 4. Szczegóły odpowiedzi

### 200 OK — preferencje znalezione

```json
{
  "user_id": "uuid",
  "default_timer_seconds": 20,
  "category_weights": {
    "ekstraklasa": 0.3,
    "historia-ms-euro": 0.2,
    "statystyki": 0.2,
    "pilka-zagraniczna": 0.2,
    "reprezentacja-polski": 0.1
  },
  "storage_limit_questions": 5000,
  "storage_limit_images_bytes": 1073741824,
  "updated_at": "2026-01-01T00:00:00Z"
}
```

### Kody statusów

| Kod | Scenariusz |
|---|---|
| `200` | Preferencje znalezione i zwrócone poprawnie |
| `401` | Użytkownik niezalogowany (brak sesji) |
| `404` | Brak wiersza preferencji dla użytkownika (nie inicjowane) |
| `500` | Nieoczekiwany błąd serwera (błąd Supabase lub inny wyjątek) |

## 5. Przepływ danych

```
Klient
  │
  │  GET /api/user/preferences
  ▼
src/pages/api/user/preferences.ts   (Astro API route — eksport GET)
  │
  ├─ 1. Odczyt context.locals.user — brak → 401
  │
  ├─ 2. Wywołanie getUserPreferences(locals.supabase, user.id)
  │        └─ src/lib/services/user-preferences.service.ts
  │              ├─ SELECT z tabeli user_preferences WHERE user_id = userId
  │              ├─ Brak wiersza → rzuca NotFoundError
  │              └─ Mapuje Json → CategoryWeightsMap, zwraca UserPreferencesDTO
  │
  ├─ 3. NotFoundError → 404 { error: "Preferences not found" }
  │
  ├─ 4. Inny wyjątek → console.error + 500 { error: "Internal server error" }
  │
  └─ 5. Sukces → 200 + JSON(UserPreferencesDTO)
```

## 6. Względy bezpieczeństwa

1. **Uwierzytelnianie:** Endpoint wymaga obecności `context.locals.user` (ustawianego przez middleware z sesji cookie Supabase). Brak użytkownika → natychmiastowy return 401 przed jakimkolwiek dostępem do bazy danych.

2. **Autoryzacja na poziomie bazy danych:** Tabela `user_preferences` powinna mieć włączone RLS z polityką `SELECT` ograniczoną do `auth.uid() = user_id`. Daje to drugą linię obrony niezależnie od logiki aplikacji.

3. **Bezpieczeństwo danych:** Kolumna `category_weights` jest przechowywana jako `Json`. Przy odczycie należy rzutować ją na `CategoryWeightsMap` — nie ufać ślepo kształtowi z bazy (możliwe niespójności migracyjne). Bezpieczne rzutowanie przez `as unknown as CategoryWeightsMap`.

4. **Brak ryzyka injection:** GET bez parametrów — nie ma wektora ataku przez query string ani body.

5. **Brak ujawniania wrażliwych danych:** Odpowiedź nie zawiera danych innych użytkowników. `storage_limit_*` to limity techniczne, nie dane wrażliwe.

## 7. Obsługa błędów

| Sytuacja | Klasa błędu | Kod HTTP | Odpowiedź |
|---|---|---|---|
| Brak sesji użytkownika | — | `401` | `{ "error": "Unauthorized" }` |
| Brak wiersza w `user_preferences` | `NotFoundError` | `404` | `{ "error": "Preferences not found" }` |
| Błąd Supabase (np. sieć, timeout) | `PostgrestError` | `500` | `{ "error": "Internal server error" }` |
| Nieoczekiwany wyjątek | `Error` | `500` | `{ "error": "Internal server error" }` |

Każdy błąd 500 musi być zalogowany przez `console.error("[GET /api/user/preferences]", err)`.

## 8. Rozważania dotyczące wydajności

1. **Pojedyncze zapytanie:** Endpoint wykonuje dokładnie jedno zapytanie `SELECT` do Supabase bez joinów — bardzo niski narzut.

2. **Indeks na `user_id`:** Tabela `user_preferences` powinna mieć PRIMARY KEY lub UNIQUE INDEX na `user_id` (co jest standardem przy relacji 1:1 z `auth.users`). Zapewnia O(1) lookup.

3. **Brak paginacji / agregacji:** Zwracany jest jeden wiersz — brak ryzyka długich zapytań.

4. **Brak cache'owania:** Preferencje mogą być zmieniane przez PUT, więc cache po stronie serwera wymaga inwalidacji. Na tym etapie nie jest wymagany — latency Supabase dla single-row SELECT jest akceptowalne.

## 9. Etapy wdrożenia

1. **Weryfikacja RLS** — upewnij się, że tabela `user_preferences` ma politykę RLS dla `SELECT`:
   ```sql
   CREATE POLICY "Users can read own preferences"
     ON user_preferences FOR SELECT
     USING (auth.uid() = user_id);
   ```
   Jeśli polityka nie istnieje, dodaj migrację `supabase/migrations/YYYYMMDDHHmmss_user_preferences_rls.sql`.

2. **Utwórz serwis** `src/lib/services/user-preferences.service.ts`:
   - Importuj `SupabaseClientType` z `@/db/supabase.client`
   - Importuj `NotFoundError` z `@/lib/errors`
   - Importuj `UserPreferencesDTO` z `@/types`
   - Zaimplementuj `getUserPreferences(supabase: SupabaseClientType, userId: string): Promise<UserPreferencesDTO>`:
     ```ts
     const { data, error } = await supabase
       .from("user_preferences")
       .select("user_id, default_timer_seconds, category_weights, storage_limit_questions, storage_limit_images_bytes, updated_at")
       .eq("user_id", userId)
       .maybeSingle();

     if (error) throw error;
     if (!data) throw new NotFoundError("Preferences not found.");

     return {
       ...data,
       category_weights: data.category_weights as unknown as CategoryWeightsMap,
     };
     ```

3. **Utwórz plik route** `src/pages/api/user/preferences.ts` (lub dodaj eksport `GET` jeśli plik już istnieje dla PUT):
   - `export const prerender = false`
   - Eksportuj `GET: APIRoute`
   - Sprawdź `locals.user` → brak: `return 401`
   - Wywołaj `getUserPreferences(locals.supabase, locals.user.id)`
   - Obsłuż `NotFoundError` → `return 404`
   - Obsłuż pozostałe błędy → `console.error` + `return 500`
   - Sukces → `return 200` z `JSON.stringify(result)`

4. **Sprawdź lint** — uruchom `npm run lint` i popraw ewentualne błędy typowania lub stylu.
