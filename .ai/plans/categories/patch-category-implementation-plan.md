# API Endpoint Implementation Plan: PATCH /api/categories/:id

## 1. Przegląd punktu końcowego

Endpoint umożliwia częściową (partial) aktualizację istniejącej kategorii użytkownika — zmianę pola `name` i/lub `description`. Oba pola żądania są opcjonalne; co najmniej jedno musi być podane (walidacja Zod). Jeśli zmieniane jest `name`, serwer regeneruje `slug` i sprawdza jego unikalność w zakresie danego użytkownika (UniqueConstraint). Autoryzacja opiera się wyłącznie na RLS Supabase — użytkownik nie może zmodyfikować kategorii innego użytkownika.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `PATCH`
- **Struktura URL:** `/api/categories/:id`
- **Parametry URL:**
  - Wymagane: `id` — UUID kategorii
- **Parametry query:** brak
- **Request Body (JSON, wszystkie pola opcjonalne, min. 1 wymagane):**

```json
{
  "name": "Ekstraklasa 2.0",
  "description": "updated"
}
```

---

## 3. Wykorzystywane typy

Zdefiniowane w `src/types.ts` — bez zmian w tym pliku:

```ts
/** PATCH /api/categories/:id request body — all fields optional. */
export interface UpdateCategoryCommand {
  name?: string;
  description?: string | null;
}

/** Category item returned in responses. */
export type CategoryDTO = Pick<
  Tables<"categories">,
  "id" | "name" | "slug" | "description" | "created_at"
>;
```

Schemat walidacji Zod (tworzony lokalnie w serwisie):

```ts
const UpdateCategoryBodySchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: "At least one of 'name' or 'description' must be provided.",
  });
```

---

## 4. Szczegóły odpowiedzi

| Status | Opis |
|--------|------|
| `200 OK` | Zaktualizowany obiekt `CategoryDTO` |
| `400 Bad Request` | Walidacja Zod nie powiodła się (nieprawidłowe `id`, puste body, błędny format) |
| `401 Unauthorized` | Brak aktywnej sesji (obsługiwane przez middleware) |
| `404 Not Found` | Kategoria o podanym `id` nie istnieje lub należy do innego użytkownika |
| `409 Conflict` | Kategoria z wygenerowanym slugiem już istnieje dla tego użytkownika |
| `500 Internal Server Error` | Nieoczekiwany błąd po stronie serwera |

**Przykładowa odpowiedź `200`:**

```json
{
  "id": "uuid",
  "name": "Ekstraklasa 2.0",
  "slug": "ekstraklasa-2-0",
  "description": "updated",
  "created_at": "2026-03-21T10:00:00Z"
}
```

---

## 5. Przepływ danych

```
PATCH /api/categories/:id
  │
  ├─ [1] Middleware (src/middleware/index.ts)
  │       └─ Weryfikuje sesję → locals.user, locals.supabase
  │
  ├─ [2] Route handler (src/pages/api/categories/[id].ts → export PATCH)
  │       ├─ ParamsSchema.safeParse(params)  → walidacja id (UUID)
  │       ├─ UpdateCategoryBodySchema.safeParse(body) → walidacja body
  │       └─ Wywołuje updateCategory(locals.supabase, id, command)
  │
  └─ [3] Service (src/lib/services/categories.service.ts → updateCategory)
          ├─ Jeśli command.name podane → slugify(command.name) → nowy slug
          ├─ Supabase UPDATE categories SET ... WHERE id = id
          │       (RLS: auth.uid() = user_id — użytkownik może edytować tylko własną)
          ├─ error.code "PGRST116" (0 rows) → throw NotFoundError
          ├─ error.code "23505" (unique) → throw ConflictError
          └─ Zwraca zaktualizowany CategoryDTO
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie** — middleware uniemożliwia dostęp bez sesji; `locals.user` jest zawsze sprawdzany przed wywołaniem serwisu.
2. **Autoryzacja przez RLS** — polityki RLS na tabeli `categories` opierają się na `auth.uid() = user_id`. Nie ma potrzeby ręcznego filtrowania po `user_id` w kodzie serwisu — baza odrzuci operację dla obcych rekordów, zwracając 0 zaktualizowanych wierszy (PGRST116 → 404).
3. **Walidacja wejścia** — Zod weryfikuje:
   - `id` jako UUID (brak możliwości SQL injection przez parametr path),
   - `name` (2–120 znaków, string),
   - `description` (nullable string, max 500 znaków).
4. **Generowanie sluga** — `slugify()` po stronie serwera normalizuje wartość `name` przed zapisem, zapobiegając przechowywaniu złośliwych lub niespodziewanych danych.
5. **Supabase client z `locals`** — klient Supabase pochodzi z `context.locals.supabase`, co gwarantuje użycie cookie sesji (RLS działa prawidłowo).

---

## 7. Obsługa błędów

| Scenariusz | Błąd / kod Supabase | Odpowiedź HTTP |
|---|---|---|
| `id` nie jest UUID | Zod validation error | `400` + `issues[]` |
| Body puste lub nie zawiera żadnego z pól | Zod `.refine` error | `400` + `issues[]` |
| `name` krótszy niż 2 lub dłuższy niż 120 znaków | Zod validation error | `400` + `issues[]` |
| Kategoria nie istnieje lub należy do innego usera | `NotFoundError` (PGRST116) | `404` |
| Slug wygenerowany z nowej nazwy jest już zajęty | `ConflictError` (23505) | `409` |
| Nieoczekiwany błąd Supabase / serwera | uncaught error | `500` |

---

## 8. Rozważania dotyczące wydajności

- Operacja wykonuje dokładnie jedno zapytanie `UPDATE ... RETURNING` — brak redundantnych SELECT.
- Indeks na `(user_id, slug)` (unikalny) jest już obsługiwany przez UniqueConstraint na tabeli `categories`, więc sprawdzenie konfliktu jest O(log n).
- Slug jest regenerowany wyłącznie gdy `name` jest podane w body — bez niepotrzebnych transformacji.

---

## 9. Etapy wdrożenia

1. **Dodaj `UpdateCategoryBodySchema`** do `src/lib/services/categories.service.ts` (lub jako lokalny eksport używany przez route handler).

2. **Dodaj funkcję `updateCategory`** do `src/lib/services/categories.service.ts`:
   - Przyjmuje `(supabase: SupabaseClientType, id: string, command: UpdateCategoryCommand): Promise<CategoryDTO>`.
   - Buduje obiekt `updatePayload` tylko z pól obecnych w `command` (nie nadpisuje niezmiennych pól).
   - Jeśli `command.name` podane → dołącz `slug: slugify(command.name)` do payloadu.
   - Wywołuje `.update(updatePayload).eq("id", id).select("id, name, slug, description, created_at").single()`.
   - Mapuje `error.code === "PGRST116"` → `throw new NotFoundError(...)`.
   - Mapuje `error.code === "23505"` → `throw new ConflictError(...)`.
   - Zwraca `data as CategoryDTO`.

3. **Dodaj eksport `UpdateCategoryBodySchema`** z serwisu (lub zduplikuj w route handler — preferowany jest eksport z serwisu).

4. **Dodaj handler `PATCH`** do `src/pages/api/categories/[id].ts`:
   - Reużyj istniejącego `ParamsSchema` do walidacji `id`.
   - Parsuj `await request.json()` i waliduj przez `UpdateCategoryBodySchema.safeParse()`.
   - Wywołaj `updateCategory(locals.supabase, parsed.data.id, body)`.
   - Zwróć `200` z `JSON.stringify(category)` i nagłówkiem `Content-Type: application/json`.
   - Obsłuż `NotFoundError` → `404`, `ConflictError` → `409`, reszta → `500` z `console.error`.

5. **Sprawdź linter** (`npm run lint`) i popraw ewentualne ostrzeżenia.
