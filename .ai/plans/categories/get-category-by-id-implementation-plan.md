# API Endpoint Implementation Plan: GET /api/categories/:id

## 1. Przegląd punktu końcowego

Endpoint zwraca pojedynczy obiekt kategorii należący do zalogowanego użytkownika na podstawie jego UUID. RLS na tabeli `categories` automatycznie zawęża wynik do rekordów należących do `auth.uid()`, dzięki czemu nie jest możliwy dostęp do cudzych kategorii.

## 2. Szczegóły żądania

- **Metoda HTTP:** GET
- **Struktura URL:** `/api/categories/[id]`
- **Parametry:**
  - Wymagane: `id` (UUID kategorii — segment ścieżki, walidowany przez Zod jako `z.string().uuid()`)
  - Opcjonalne: brak
- **Request Body:** brak

## 3. Wykorzystywane typy

Zdefiniowane w `src/types.ts` — nie wymagają zmian:

```ts
// Odpowiedź 200
type CategoryDTO = Pick<Tables<"categories">, "id" | "name" | "slug" | "description" | "created_at">;
```

Nowy schemat walidacji parametrów ścieżki (tworzony w pliku route'a):

```ts
const ParamsSchema = z.object({
  id: z.string().uuid(),
});
```

## 4. Szczegóły odpowiedzi

| Status | Opis | Treść |
|---|---|---|
| `200 OK` | Kategoria znaleziona | `CategoryDTO` |
| `400 Bad Request` | `id` nie jest poprawnym UUID | `{ error: "Validation failed", issues: [...] }` |
| `401 Unauthorized` | Brak sesji | `{ error: "Unauthorized" }` |
| `404 Not Found` | Kategoria nie istnieje lub należy do innego użytkownika | `{ error: "Category not found" }` |
| `500 Internal Server Error` | Nieoczekiwany błąd bazy danych | `{ error: "Internal server error" }` |

Przykładowa odpowiedź `200`:

```json
{
  "id": "uuid",
  "name": "Ekstraklasa",
  "slug": "ekstraklasa",
  "description": "Pytania o polską ekstraklasę",
  "created_at": "2026-03-21T10:00:00Z"
}
```

## 5. Przepływ danych

```
Request → Astro GET handler ([id].ts)
  → walidacja params.id (Zod uuid)
  → sprawdzenie locals.user (401 jeśli brak)
  → getCategoryById(locals.supabase, id) [categories.service.ts]
      → supabase.from("categories").select(...).eq("id", id).single()
      → RLS ogranicza wyniki do auth.uid()
      → brak wiersza → rzuca NotFoundError
  ← CategoryDTO
  → Response 200 JSON
```

## 6. Względy bezpieczeństwa

- **Uwierzytelnienie:** sprawdzić `locals.user`; jeśli `null` → `401`.
- **Autoryzacja przez RLS:** Supabase wykonuje zapytanie w kontekście sesji cookie (`locals.supabase`). Polityka RLS `USING (user_id = auth.uid())` na tabeli `categories` zapewnia, że użytkownik nigdy nie otrzyma cudzej kategorii — nawet jeśli zna jej UUID. Endpoint nie musi ręcznie filtrować po `user_id`.
- **Walidacja wejścia:** parametr `id` jest walidowany jako UUID v4 przez Zod przed wywołaniem bazy danych, co zapobiega wstrzyknięciom i nieoczekiwanym formatom.
- **Brak ujawniania szczegółów wewnętrznych:** błędy bazy danych logowane są serwerowo (`console.error`); do klienta trafia wyłącznie ogólny komunikat `"Internal server error"`.

## 7. Obsługa błędów

| Scenariusz | Mechanizm | Kod HTTP |
|---|---|---|
| `id` nie jest UUID | `ParamsSchema.safeParse` → `!parsed.success` | 400 |
| Brak sesji | `!locals.user` | 401 |
| Brak wiersza (`.single()` brak danych) | `getCategoryById` rzuca `NotFoundError` | 404 |
| Błąd Supabase (sieć, DB) | Catch blok → `console.error` | 500 |

## 8. Rozważania dotyczące wydajności

- Zapytanie pobiera jeden wiersz przez klucz główny (`id`) filtrowany przez indeks PK — złożoność O(1), brak dodatkowych optymalizacji wymaganych.
- Kolumna `id` jest `uuid PRIMARY KEY` — indeks domyślny zapewnia szybkie zlokalizowanie rekordu.
- W przyszłości można rozważyć krótkotrwały cache na poziomie CDN (stale-while-revalidate), jeśli dane kategorii będą rzadko zmieniane.

## 9. Kroki implementacji

1. **Dodać funkcję `getCategoryById` do `src/lib/services/categories.service.ts`**
   - Sygnatura: `async function getCategoryById(supabase: SupabaseClientType, id: string): Promise<CategoryDTO>`
   - Użyć `.eq("id", id).single()`; gdy `data` jest `null` lub `error.code === "PGRST116"` rzucić `NotFoundError`.

2. **Utworzyć plik route'a `src/pages/api/categories/[id].ts`**
   - Wyeksportować `export const prerender = false`.
   - Zdefiniować `ParamsSchema = z.object({ id: z.string().uuid() })`.
   - Zaimplementować eksport `GET: APIRoute`:
     1. Walidacja `Astro.params` przez `ParamsSchema.safeParse` → `400` przy błędzie.
     2. Sprawdzenie `locals.user` → `401` przy braku.
     3. Wywołanie `getCategoryById(locals.supabase, id)`.
     4. Catch `NotFoundError` → `404`; pozostałe błędy → `500` z `console.error`.
     5. Zwrócenie `Response` ze statusem `200` i `JSON.stringify(category)`.
