# API Endpoint Implementation Plan: DELETE /api/categories/:id

## 1. Przegląd punktu końcowego

Endpoint usuwa kategorię należącą do uwierzytelnionego użytkownika. Przed usunięciem rekordu z tabeli `categories` serwis jawnie kasuje wszystkie powiązane rekordy z tabeli `question_categories` (relacja N:M między pytaniami a kategorią). Operacja jest idempotentna z perspektywy wyniku, ale nieistniejący zasób zwraca `404`. Zakończona sukcesem odpowiedź nie zawiera treści (`204 No Content`).

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `DELETE`
- **Struktura URL:** `/api/categories/:id`
- **Parametry:**
  - Wymagane: `id` — UUID kategorii (parametr ścieżki)
  - Opcjonalne: brak
- **Request Body:** brak

---

## 3. Wykorzystywane typy

Endpoint nie zwraca ciała odpowiedzi, więc nie są wymagane nowe typy DTO. Używane są jedynie istniejące elementy:

| Typ / Schema | Źródło | Zastosowanie |
|---|---|---|
| `ParamsSchema` (`z.object({ id: z.string().uuid() })`) | `src/pages/api/categories/[id].ts` | Walidacja parametru ścieżki |
| `NotFoundError` | `src/lib/errors.ts` | Sygnalizowanie braku kategorii |
| `SupabaseClientType` | `src/db/supabase.client.ts` | Typ klienta Supabase przekazywanego do serwisu |

Nie jest wymagane tworzenie nowych typów ani Command Models, ponieważ operacja nie przyjmuje treści żądania.

---

## 4. Szczegóły odpowiedzi

| Scenariusz | Kod statusu | Treść |
|---|---|---|
| Kategoria usunięta pomyślnie | `204 No Content` | brak |
| Niepoprawny UUID w parametrze ścieżki | `400 Bad Request` | `{ "error": "Validation failed", "issues": [...] }` |
| Brak sesji / niezalogowany użytkownik | `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| Kategoria nie istnieje (lub należy do innego użytkownika) | `404 Not Found` | `{ "error": "Category not found" }` |
| Nieoczekiwany błąd serwera | `500 Internal Server Error` | `{ "error": "Internal server error" }` |

---

## 5. Przepływ danych

```
DELETE /api/categories/:id
       │
       ▼
[1] Walidacja params.id (Zod – UUID)
       │ błąd → 400
       ▼
[2] Weryfikacja locals.user / locals.supabase
       │ brak sesji → 401
       ▼
[3] deleteCategory(supabase, id)          ← categories.service.ts
       │
       ├─[3a] DELETE FROM question_categories WHERE category_id = id
       │         (jawne usunięcie powiązań, RLS supabase działa na auth.uid())
       │
       ├─[3b] DELETE FROM categories WHERE id = id
       │         (RLS ogranicza do rekordów należących do auth.uid())
       │         0 usuniętych wierszy → throw NotFoundError
       │
       └─[3c] Brak błędu → resolve (void)
       │
       ▼
[4] Zwróć 204 No Content
```

**Uwagi dotyczące RLS:**
- Tabela `categories` ma politykę RLS opartą na `auth.uid()`. Zapytanie `DELETE` na cudzej kategorii zwróci 0 usuniętych wierszy, co serwis traktuje jako `NotFoundError` → `404`.
- Tabela `question_categories` ma politykę RLS opartą na `auth.uid()`. Jawne usunięcie powiązań przed usunięciem kategorii zapobiega potencjalnym błędom klucza obcego w sytuacji, gdy w schemacie DB nie skonfigurowano `ON DELETE CASCADE` lub gdy CASCADE jest zablokowane przez polityki RLS.

---

## 6. Względy bezpieczeństwa

- **Uwierzytelnienie:** Każde żądanie musi posiadać ważną sesję cookie zarządzaną przez `@supabase/ssr`. Middleware przypisuje `locals.user` i `locals.supabase`. Brak sesji skutkuje `401`.
- **Autoryzacja:** RLS na tabeli `categories` gwarantuje, że `DELETE` dotyczy wyłącznie wierszy należących do `auth.uid()`. Użytkownik nie może usunąć kategorii innego użytkownika — brak wiersza zostaje zwrócony jako `404`, nie ujawniając istnienia zasobu.
- **Walidacja wejścia:** Parametr `id` jest walidowany jako UUID przez Zod przed jakimkolwiek zapytaniem do bazy danych. Uniemożliwia to SQL Injection poprzez parametr ścieżki.
- **Brak wrażliwych danych w odpowiedzi:** `204 No Content` nie zwraca żadnych danych — nie ma ryzyka wycieku informacji.

---

## 7. Obsługa błędów

| Błąd | Przyczyna | Odpowiedź |
|---|---|---|
| Zod `safeParse` failure na `params.id` | Niepoprawny UUID | `400` z listą `issues` |
| `!locals.user` | Brak ważnej sesji | `401` |
| `NotFoundError` z serwisu | `DELETE` nie usunął żadnego wiersza (kategoria nie istnieje lub należy do innego użytkownika) | `404` |
| Nieobsłużony wyjątek Supabase | Błąd sieci, błąd DB | `500` + `console.error` z kontekstem |

Obsługa błędów stosuje wzorzec wczesnych zwrotów (`if (err instanceof X) return ...`) zgodnie z konwencjami projektu.

---

## 8. Rozważania dotyczące wydajności

- Operacja składa się z dwóch zapytań DELETE: najpierw `question_categories`, potem `categories`. Oba są indeksowane (`category_id` FK w `question_categories`, `id` PK w `categories`), więc koszt jest stały i niski.
- Nie jest wymagane pobieranie danych (brak `SELECT`) przed usunięciem — brak wiersza po `DELETE` traktowany jest jako `NotFoundError`, co eliminuje zbędne round-tripy.
- Brak potrzeby paginacji, cache'owania ani optymalizacji N+1.

---

## 9. Etapy wdrożenia

### Krok 1 — Dodaj funkcję serwisu `deleteCategory` do `src/lib/services/categories.service.ts`

Dopisz poniższą funkcję na końcu pliku:

```typescript
/**
 * Deletes a category and all associated question_categories rows.
 * RLS on `categories` scopes the DELETE to auth.uid(), so deleting a
 * non-existent or foreign category results in 0 rows deleted → NotFoundError.
 *
 * @throws {NotFoundError} when the category does not exist or belongs to another user
 */
export async function deleteCategory(supabase: SupabaseClientType, id: string): Promise<void> {
  // 1. Remove associations first to avoid FK constraint violations.
  const { error: assocError } = await supabase
    .from("question_categories")
    .delete()
    .eq("category_id", id);

  if (assocError) {
    throw assocError;
  }

  // 2. Delete the category itself; RLS enforces ownership.
  const { error, count } = await supabase
    .from("categories")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    throw error;
  }

  if ((count ?? 0) === 0) {
    throw new NotFoundError("Category not found.");
  }
}
```

### Krok 2 — Dodaj handler `DELETE` w `src/pages/api/categories/[id].ts`

Dopisz poniższy eksport do istniejącego pliku (po `PATCH`):

```typescript
// ---------------------------------------------------------------------------
// DELETE /api/categories/:id — delete category and its question associations
// ---------------------------------------------------------------------------

export const DELETE: APIRoute = async ({ locals, params }) => {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await deleteCategory(locals.supabase, parsed.data.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Category not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[DELETE /api/categories/:id]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
```

### Krok 3 — Zaktualizuj import w `src/pages/api/categories/[id].ts`

Dodaj `deleteCategory` do importu z serwisu:

```typescript
import { getCategoryById, updateCategory, UpdateCategoryBodySchema, deleteCategory } from "@/lib/services/categories.service";
```

### Krok 4 — Weryfikacja

1. Uruchom `npm run lint` i popraw ewentualne ostrzeżenia ESLint.
2. Przetestuj manualnie scenariusze:
   - `DELETE /api/categories/<valid-uuid>` z istniejącą kategorią → `204`
   - `DELETE /api/categories/<valid-uuid>` z kategorią powiązaną z pytaniami → `204` (asocjacje usunięte)
   - `DELETE /api/categories/<non-existent-uuid>` → `404`
   - `DELETE /api/categories/not-a-uuid` → `400`
   - Żądanie bez ważnej sesji cookie → `401`
