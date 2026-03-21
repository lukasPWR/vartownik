# API Endpoint Implementation Plan: POST /api/categories

## 1. Przegląd punktu końcowego

Endpoint tworzy nową kategorię tematyczną dla zalogowanego użytkownika. Slug jest generowany po stronie serwera na podstawie pola `name` (slugify). Unikalne ograniczenie na parze `(user_id, slug)` chroni przed duplikatami w obrębie konta.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `POST`
- **Struktura URL:** `/api/categories`
- **Parametry:**
  - Wymagane: brak (dane w body)
  - Opcjonalne: brak
- **Request Body:**

```json
{
  "name": "Ekstraklasa",
  "description": "Pytania o polską ekstraklasę"
}
```

| Pole | Typ | Wymagane | Ograniczenia |
|---|---|---|---|
| `name` | `string` | ✅ | 2–120 znaków |
| `description` | `string \| null` | ❌ | max 500 znaków |

---

## 3. Wykorzystywane typy

Wszystkie typy już istnieją w `src/types.ts` — nie należy tworzyć nowych.

```ts
// Command Model — ciało żądania
interface CreateCategoryCommand {
  name: string;
  description?: string | null;
}

// DTO — kształt odpowiedzi
type CategoryDTO = Pick<Tables<"categories">, "id" | "name" | "slug" | "description" | "created_at">;
```

---

## 4. Szczegóły odpowiedzi

### `201 Created`
Zwraca `CategoryDTO` bez `user_id`.

```json
{
  "id": "uuid",
  "name": "Ekstraklasa",
  "slug": "ekstraklasa",
  "description": "Pytania o polską ekstraklasę",
  "created_at": "2026-03-21T10:00:00Z"
}
```

### Kody błędów

| Status | Przypadek |
|---|---|
| `400 Bad Request` | Nieprawidłowe/brakujące pola (Zod) |
| `401 Unauthorized` | Brak sesji (`locals.user` jest `null`) |
| `409 Conflict` | Slug już istnieje dla tego użytkownika (unikalny constraint DB) |
| `500 Internal Server Error` | Nieoczekiwany błąd Supabase |

---

## 5. Przepływ danych

```
Request
  → Astro API Route (src/pages/api/categories/index.ts)
      → Sprawdzenie locals.user (401 jeśli brak)
      → Parsowanie body (400 jeśli invalid JSON)
      → Walidacja Zod CreateCategoryBodySchema (400 jeśli błąd)
      → categoriesService.createCategory(supabase, userId, command)
          → slugify(name) → slug
          → supabase.from("categories").insert({ user_id, name, slug, description })
              ← błąd 23505 (unique violation) → throw ConflictError
          ← Row: categories.Row
          → Mapowanie do CategoryDTO (bez user_id)
      ← CategoryDTO
  ← Response 201 JSON
```

---

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie**: Weryfikacja `locals.user` na początku handlera — każde żądanie bez sesji zwraca `401`.
2. **Autoryzacja przez RLS**: Klient Supabase z sesji (`locals.supabase`) automatycznie przekazuje token użytkownika; polityki RLS na tabeli `categories` ograniczają dostęp wyłącznie do rekordów z `user_id = auth.uid()`. INSERT policy musi zezwalać na wstawianie wierszy z `user_id = auth.uid()`.
3. **Slug injection**: Slug generowany jest server-side przez deterministyczną funkcję `slugify` (nie pochodzi bezpośrednio od użytkownika), co eliminuje ryzyko wstrzyknięcia.
4. **Walidacja wejścia**: Zod odrzuca nadmiarowe pola (`.strict()` lub explicit pick), limituje długość pól, co chroni przed nadmiernie dużymi payloadami.
5. **user_id**: Pole `user_id` jest zawsze ustawiane przez serwer na podstawie sesji — nigdy nie pochodzi z body żądania.
6. **Odpowiedź**: `user_id` jest pomijany w odpowiedzi (`CategoryDTO` go nie zawiera).

---

## 7. Obsługa błędów

| Źródło błędu | Typ błędu | HTTP status | Obsługa |
|---|---|---|---|
| `locals.user === null` | — | `401` | Early return w handlerze |
| Nieprawidłowe JSON body | `SyntaxError` | `400` | try/catch `request.json()` |
| Nieudana walidacja Zod | `ZodError` | `400` | `safeParse` + formatted issues |
| Duplicate slug (DB `23505`) | `ConflictError` | `409` | catch w handlerze, sprawdzenie `instanceof ConflictError` |
| Nieoczekiwany błąd DB | `PostgrestError` lub `Error` | `500` | catch w handlerze, `console.error`, ogólna wiadomość |

Serwis rzuca `ConflictError` (z `src/lib/errors.ts`) gdy Supabase zwróci błąd z kodem `23505`.

---

## 8. Rozważania dotyczące wydajności

- Jeden INSERT do bazy — brak dodatkowych zapytań (slug sprawdzany implicit przez unique constraint, nie przez SELECT).
- Brak potrzeby cache'owania — operacje mutujące.
- Indeks na `(user_id, slug)` powinien istnieć jako unique constraint — upewnij się, że migracja go zawiera.

---

## 9. Etapy wdrożenia

### Krok 1 — Funkcja `slugify` w `src/lib/utils.ts`

Dodaj helper (jeśli jeszcze nie istnieje):

```ts
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // usuń diakrytyki
    .replace(/[^a-z0-9\s-]/g, "")   // usuń niedozwolone znaki
    .trim()
    .replace(/\s+/g, "-")            // spacje → myślniki
    .replace(/-+/g, "-");            // kolaps wielokrotnych myślników
}
```

---

### Krok 2 — Serwis `src/lib/services/categories.service.ts` (nowy plik)

```ts
import type { SupabaseClientType } from "@/db/supabase.client";
import { ConflictError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import type { CategoryDTO, CreateCategoryCommand } from "@/types";

export async function createCategory(
  supabase: SupabaseClientType,
  userId: string,
  command: CreateCategoryCommand
): Promise<CategoryDTO> {
  const slug = slugify(command.name);

  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: userId,
      name: command.name,
      slug,
      description: command.description ?? null,
    })
    .select("id, name, slug, description, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ConflictError(`Category with slug "${slug}" already exists.`);
    }
    throw error;
  }

  return data as CategoryDTO;
}
```

---

### Krok 3 — API Route `src/pages/api/categories/index.ts` (nowy plik)

```ts
import type { APIRoute } from "astro";
import { z } from "zod";

import { ConflictError } from "@/lib/errors";
import { createCategory } from "@/lib/services/categories.service";

export const prerender = false;

const CreateCategoryBodySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
});

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = CreateCategoryBodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const category = await createCategory(locals.supabase, locals.user.id, parsed.data);
    return new Response(JSON.stringify(category), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[POST /api/categories]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
```

---

### Krok 4 — Migracja Supabase (jeśli nie istnieje)

Upewnij się, że tabela `categories` ma unikalny constraint:

```sql
-- supabase/migrations/YYYYMMDDHHmmss_categories_unique_slug.sql
ALTER TABLE categories
  ADD CONSTRAINT categories_user_id_slug_unique UNIQUE (user_id, slug);
```

Polityki RLS:

```sql
-- SELECT
CREATE POLICY "Users can read own categories"
  ON categories FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT
CREATE POLICY "Users can insert own categories"
  ON categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

---

### Krok 5 — Weryfikacja integracji

1. `slugify` działa poprawnie dla polskich znaków (np. „Śląsk" → `slask`).
2. `POST /api/categories` bez sesji → `401`.
3. `POST /api/categories` z `name: "A"` (za krótki) → `400`.
4. `POST /api/categories` z poprawnym body → `201` z `CategoryDTO`.
5. Ponowny `POST /api/categories` z identycznym `name` → `409`.
