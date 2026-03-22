# API Endpoint Implementation Plan: GET /api/categories

## 1. Przegląd punktu końcowego

Endpoint zwraca paginowaną listę kategorii należących do uwierzytelnionego użytkownika. Dane pobierane są z tabeli `categories` z obowiązkowym filtrowaniem po `user_id` (wymuszonym przez RLS). Obsługuje sortowanie po nazwie rosnąco (`name_asc`, domyślnie) lub po dacie utworzenia malejąco (`created_at_desc`).

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `GET`
- **Struktura URL:** `/api/categories`
- **Request Body:** brak

### Parametry

**Wymagane (niejawne):**
- sesja użytkownika — cookie Supabase SSR (dostarczana automatycznie przez middleware)

**Opcjonalne (query string):**

| Parametr | Typ     | Wartość domyślna | Opis                                          |
|----------|---------|------------------|-----------------------------------------------|
| `page`   | integer | `1`              | Numer strony (≥ 1)                            |
| `limit`  | integer | `20`             | Rozmiar strony (1–100)                        |
| `sort`   | enum    | `name_asc`       | `name_asc` \| `created_at_desc`               |

---

## 3. Wykorzystywane typy

Wszystkie typy są już zdefiniowane w `src/types.ts`. Nie jest wymagane tworzenie nowych.

```typescript
import type {
  ListCategoriesResponseDTO, // { data: CategoryDTO[], pagination: PaginationDTO }
  CategoryDTO,               // Pick<Tables<"categories">, "id"|"name"|"slug"|"description"|"created_at">
  PaginationDTO,             // { page: number, limit: number, total: number }
} from "@/types";
```

Lokalny schemat Zod dla parametrów zapytania (`ListCategoriesQuery`) definiowany wewnątrz serwisu — nie wymaga eksportu do `types.ts`.

---

## 4. Szczegóły odpowiedzi

### 200 OK

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Historia MŚ/Euro",
      "slug": "historia-ms-euro",
      "description": null,
      "created_at": "2026-03-21T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5 }
}
```

### Kody błędów

| Kod | Scenariusz                                     |
|-----|------------------------------------------------|
| 400 | Nieprawidłowe parametry zapytania (Zod)        |
| 401 | Brak lub nieważna sesja użytkownika            |
| 500 | Nieoczekiwany błąd po stronie serwera          |

---

## 5. Przepływ danych

```
Klient → GET /api/categories?page=1&limit=20&sort=name_asc
  → middleware: weryfikacja sesji, locals.user i locals.supabase
  → API route (index.ts): walidacja query params (Zod)
  → listCategories(supabase, query) — categories.service.ts
      → supabase.from("categories")
          .select("id, name, slug, description, created_at", { count: "exact" })
          .order(kolumna, { ascending })
          .range(offset, offset + limit - 1)
      ← { data: CategoryDTO[], count: number }
  ← ListCategoriesResponseDTO (200 OK)
```

RLS na tabeli `categories` automatycznie ogranicza wyniki do rekordów z `user_id = auth.uid()` — brak potrzeby ręcznego filtrowania po `user_id` w zapytaniu.

Obliczenie `offset` = `(page - 1) * limit`; `total` pochodzi z pola `count` zwróconego przez Supabase przy `{ count: "exact" }`.

---

## 6. Względy bezpieczeństwa

- **Uwierzytelnianie:** middleware weryfikuje sesję przed obsługą zapytania; brak `locals.user` → `401 Unauthorized`.
- **Autoryzacja:** RLS na tabeli `categories` (`using (user_id = auth.uid())`) — użytkownik widzi wyłącznie własne dane; brak `user_id` w zapytaniu po stronie aplikacji nie jest luką.
- **Walidacja wejścia:** parametry query parsowane przez Zod — ochrona przed wstrzyknięciem nieoczekiwanych wartości.
- **Brak wrażliwych pól:** kolumna `user_id` jest wykluczona z odpowiedzi JSON (nie ma jej w `CategoryDTO`).
- **Limity paginacji:** `limit` jest ograniczony do 100 przez schemat Zod — zapobieganie nadmiernemu pobieraniu danych.

---

## 7. Obsługa błędów

| Scenariusz                                | Kod | Odpowiedź                                      |
|-------------------------------------------|-----|------------------------------------------------|
| Brak sesji (`!locals.user`)               | 401 | `{ "error": "Unauthorized" }`                  |
| Nieprawidłowe query params (Zod fail)     | 400 | `{ "error": "Validation failed", "issues": [] }` |
| Błąd zapytania Supabase (sieć / DB)       | 500 | `{ "error": "Internal server error" }`         |

Błędy Supabase (obiekt `error` w destrukturyzacji) powinny być logowane do `console.error` po stronie serwera; klientowi zwracany jest wyłącznie ogólny komunikat `500`.

---

## 8. Rozważania dotyczące wydajności

- Indeks na `categories(user_id, name)` już powinien istnieć (lub zostać dodany w migracji) — optymalizuje filtrowanie i sortowanie `name_asc` w jednym B-tree scan.
- Indeks na `categories(user_id, created_at DESC)` — optymalizuje wariant sortowania `created_at_desc`.
- `{ count: "exact" }` generuje `COUNT(*)` — przy dużych zbiorach rozważyć `{ count: "estimated" }`, ale przy typowych limitach użytkownika (kilkaset kategorii) koszt jest pomijalny.
- Brak joinów — tabela `categories` jest prosta, zapytanie skaluje się liniowo ze zbiorem użytkownika.

---

## 9. Etapy wdrożenia

1. **Dodaj `listCategories` do `src/lib/services/categories.service.ts`**
   - Zdefiniuj lokalny schemat Zod `ListCategoriesQuerySchema` z polami `page` (default 1, min 1), `limit` (default 20, min 1, max 100), `sort` (enum `["name_asc", "created_at_desc"]`, default `"name_asc"`).
   - Zmapuj wartość `sort` na parę `(column, ascending)`:
     - `name_asc` → `("name", true)`
     - `created_at_desc` → `("created_at", false)`
   - Oblicz `offset = (page - 1) * limit`.
   - Wywołaj `supabase.from("categories").select("id, name, slug, description, created_at", { count: "exact" }).order(column, { ascending }).range(offset, offset + limit - 1)`.
   - Zwróć `ListCategoriesResponseDTO`: `{ data, pagination: { page, limit, total: count ?? 0 } }`.
   - W przypadku błędu Supabase (`error !== null`) — `throw error` (obsługa w warstwie route).

2. **Dodaj handler `GET` do `src/pages/api/categories/index.ts`**
   - Wyeksportuj `export const GET: APIRoute`.
   - Sprawdź `locals.user` → `401` jeśli brak.
   - Odczytaj parametry z `new URL(request.url).searchParams`.
   - Parsuj przez `ListCategoriesQuerySchema.safeParse(...)` → `400` z `issues` jeśli walidacja nie powiodła się.
   - Wywołaj `listCategories(locals.supabase, parsed.data)`.
   - Zwróć `new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } })`.
   - W bloku `catch` zwróć `500` z ogólnym komunikatem i loguj błąd przez `console.error`.

3. **Weryfikacja integracji**
   - Sprawdź, że istniejący handler `POST` w tym samym pliku nie koliduje z nowym `GET`.
   - Uruchom `npm run lint` i popraw ewentualne ostrzeżenia ESLint/Prettier.
