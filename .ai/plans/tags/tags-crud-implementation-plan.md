# API Endpoint Implementation Plan: Tags CRUD

## 1. Przegląd punktu końcowego

Trzy endpointy obsługujące zarządzanie tagami przypisanymi do użytkownika:

| Metoda | Ścieżka | Opis |
|---|---|---|
| `GET` | `/api/tags` | Pobierz wszystkie tagi zalogowanego użytkownika (bez paginacji) |
| `POST` | `/api/tags` | Utwórz nowy tag (unikalność nazwy case-insensitive per user) |
| `DELETE` | `/api/tags/:id` | Usuń tag (kaskadowo usuwa `question_tags`) |

RLS na tabeli `tags` automatycznie zawęża widoczność do `auth.uid()`. Każdy tag jest powiązany z użytkownikiem przez kolumnę `user_id`.

---

## 2. Szczegóły żądania

### `GET /api/tags`
- **Metoda HTTP:** GET
- **URL:** `/api/tags`
- **Parametry wymagane:** brak
- **Parametry opcjonalne:** brak (brak paginacji wg spec)
- **Request Body:** brak

### `POST /api/tags`
- **Metoda HTTP:** POST
- **URL:** `/api/tags`
- **Parametry wymagane:** brak (URL)
- **Request Body:**
  ```json
  { "name": "finals" }
  ```
  | Pole | Typ | Ograniczenia |
  |---|---|---|
  | `name` | `string` | wymagane, min 1 znak, max 50 znaków |

### `DELETE /api/tags/:id`
- **Metoda HTTP:** DELETE
- **URL:** `/api/tags/:id`
- **Parametry wymagane:** `id` (UUID, path param)
- **Request Body:** brak

---

## 3. Wykorzystywane typy

Wszystkie typy są już zdefiniowane w `src/types.ts`:

```typescript
// Encja tagu zwracana przez GET i POST
type TagDTO = Pick<Tables<"tags">, "id" | "name" | "created_at">;
// { id: string; name: string; created_at: string }

// Ciało żądania POST
interface CreateTagCommand {
  name: string;
}

// Odpowiedź GET /api/tags
interface ListTagsResponseDTO {
  data: TagDTO[];
}
```

Schemat tabeli DB (`tags`):
```typescript
Row:    { id: string; name: string; user_id: string; created_at: string }
Insert: { id?: string; name: string; user_id: string; created_at?: string }
```

---

## 4. Szczegóły odpowiedzi

### `GET /api/tags` → `200 OK`
```json
{
  "data": [
    { "id": "uuid", "name": "finals", "created_at": "2026-03-21T10:00:00Z" }
  ]
}
```

### `POST /api/tags` → `201 Created`
```json
{ "id": "uuid", "name": "finals", "created_at": "2026-03-21T10:00:00Z" }
```

### `DELETE /api/tags/:id` → `204 No Content`
Brak ciała odpowiedzi.

---

## 5. Przepływ danych

### GET
1. Middleware weryfikuje sesję → `locals.user`, `locals.supabase`.
2. Route wywołuje `listTags(locals.supabase)`.
3. Serwis wykonuje `supabase.from("tags").select("id, name, created_at").order("name", { ascending: true })`.
4. RLS zwraca tylko tagi dla `auth.uid()`.
5. Route zwraca `200` z `ListTagsResponseDTO`.

### POST
1. Middleware weryfikuje sesję.
2. Route parsuje i waliduje body Zod (`CreateTagBodySchema`).
3. Route wywołuje `createTag(locals.supabase, locals.user.id, command)`.
4. Serwis wykonuje `supabase.from("tags").insert({ user_id, name }).select(...)`.
5. Jeśli kod błędu DB to `23505` (unique violation) → rzuca `ConflictError`.
6. Route zwraca `201` z `TagDTO`.

### DELETE
1. Middleware weryfikuje sesję.
2. Route waliduje `id` path param jako UUID (Zod).
3. Route wywołuje `deleteTag(locals.supabase, locals.user.id, id)`.
4. Serwis wykonuje `supabase.from("tags").delete().eq("id", id).eq("user_id", userId)`.
5. Sprawdza `count` zwrócony przez Supabase — jeśli `0` → rzuca `NotFoundError`.
6. Route zwraca `204`.

> Usunięcie tagu automatycznie usuwa powiązane wiersze w `question_tags` przez kaskadę FK (zakładając `ON DELETE CASCADE` w migracji).

---

## 6. Względy bezpieczeństwa

- **Uwierzytelnianie:** Każdy endpoint wymaga zalogowanej sesji (`locals.user`). Brak sesji → `401 Unauthorized`.
- **Autoryzacja:** RLS na tabeli `tags` (`using (user_id = auth.uid())`) gwarantuje, że użytkownik widzi i modyfikuje tylko własne tagi. Dodatkowo `deleteTag` filtruje po `user_id = locals.user.id` jako defense-in-depth.
- **Walidacja wejścia:** Zod waliduje wszystkie dane wejściowe przed jakąkolwiek operacją DB (brak surowych danych z request w zapytaniach).
- **`user_id` z sesji:** Pole `user_id` przy insercie zawsze pochodzi z `locals.user.id`, nigdy z ciała żądania.
- **UUID validation:** `id` w path param DELETE walidowany przez `z.string().uuid()` — unikamy invalid query do DB.
- **Brak ekspozycji user_id:** `TagDTO` nie zawiera `user_id` — nie jest ujawniany w odpowiedzi.

---

## 7. Obsługa błędów

| Scenariusz | Kod | Odpowiedź |
|---|---|---|
| Brak sesji (unauthenticated) | `401` | `{ "error": "Unauthorized" }` |
| Zod validation failure (POST body) | `400` | `{ "error": "Validation failed", "issues": [...] }` |
| Nieprawidłowy UUID w path param | `400` | `{ "error": "Validation failed", "issues": [...] }` |
| Tag o tej nazwie już istnieje (case-insensitive) | `409` | `{ "error": "Tag with this name already exists." }` |
| Tag nie znaleziony / nie należy do użytkownika | `404` | `{ "error": "Tag not found." }` |
| Błąd Supabase / inny wyjątek | `500` | `{ "error": "Internal server error" }` |

**Obsługa `ConflictError` i `NotFoundError`:** importowane z `@/lib/errors` — te same klasy co w `categories.service.ts`. Route sprawdza `instanceof` przed zwróceniem `500`.

---

## 8. Rozważania dotyczące wydajności

- Brak paginacji dla tagów jest akceptowalny — zakłada się, że liczba tagów per user jest niewielka (dziesiątki).
- Indeks DB na `(user_id, lower(name))` powinien istnieć dla unikalności case-insensitive i szybkiego lookup. Jeśli nie istnieje — dodać w migracji.
- Operacja `DELETE` z filtrem `id + user_id` trafi w PK indeks.

---

## 9. Etapy wdrożenia

1. **Weryfikacja constraintów DB** — sprawdzić migracje w `supabase/migrations/`, czy tabela `tags` ma:
   - Unikalny indeks na `(user_id, lower(name))` dla case-insensitive uniqueness.
   - RLS policies: `SELECT`, `INSERT`, `DELETE` dla roli `authenticated` z `using/with check (user_id = auth.uid())`.
   - FK z `question_tags.tag_id → tags.id ON DELETE CASCADE`.
   - Jeśli brak — stworzyć nową migrację `YYYYMMDDHHmmss_tags_rls_and_indexes.sql`.

2. **Serwis `src/lib/services/tags.service.ts`** — stworzyć plik z trzema funkcjami:
   - `listTags(supabase: SupabaseClientType): Promise<ListTagsResponseDTO>`
   - `createTag(supabase: SupabaseClientType, userId: string, command: CreateTagCommand): Promise<TagDTO>`
   - `deleteTag(supabase: SupabaseClientType, userId: string, id: string): Promise<void>`
   - Zaimportować `ConflictError`, `NotFoundError` z `@/lib/errors`.
   - Mapować błąd DB `23505` → `ConflictError`.
   - W `deleteTag` sprawdzać liczbę usuniętych wierszy i rzucać `NotFoundError` przy `0`.

3. **Route `src/pages/api/tags/index.ts`** — obsługa `GET` i `POST`:
   - `export const prerender = false`
   - `GET`: sprawdź `locals.user` → wywołaj `listTags` → zwróć `200`.
   - `POST`: sprawdź `locals.user` → parsuj JSON → waliduj `CreateTagBodySchema` → wywołaj `createTag` → obsłuż `ConflictError` (409) → zwróć `201`.
   - Obsłuż błędy `instanceof ConflictError` i nieznane wyjątki `500`.

4. **Route `src/pages/api/tags/[id].ts`** — obsługa `DELETE`:
   - `export const prerender = false`
   - Waliduj `params.id` przez `z.string().uuid()`.
   - Sprawdź `locals.user` → wywołaj `deleteTag` → obsłuż `NotFoundError` (404) → zwróć `204`.

5. **Weryfikacja lint** — `npm run lint` i popraw ewentualne błędy ESLint.

6. **Weryfikacja manualna** — przetestować endpointy przez klienta HTTP (np. curl / Postman) z działającą lokalnie instancją Supabase (`npx supabase start`).
