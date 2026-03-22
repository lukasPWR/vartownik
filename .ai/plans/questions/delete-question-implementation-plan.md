# API Endpoint Implementation Plan: DELETE /api/questions/:id

## 1. Przegląd punktu końcowego

Endpoint usuwa pojedyncze pytanie należące do zalogowanego użytkownika. Usunięcie jest **twarde** (trwałe) — powiązane rekordy w tabelach `question_categories`, `question_tags` oraz `question_edits` usuwane są kaskadowo przez bazę danych. Jeśli pytanie posiada powiązane rekordy `attempts`, operacja jest blokowana — w takim przypadku należy użyć miękkiego usunięcia (`PATCH` z `status: "archived"`).

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `DELETE`
- **Struktura URL:** `/api/questions/:id`
- **Parametry:**
  - Wymagane (path): `id` — UUID pytania
  - Opcjonalne: brak
- **Request Body:** brak

---

## 3. Wykorzystywane typy

Brak nowych typów DTO ani Command Modeli — operacja nie zwraca ciała odpowiedzi (`204 No Content`).

Używane są istniejące typy błędów z `src/lib/errors.ts`:
- `NotFoundError` — pytanie nie istnieje lub nie należy do użytkownika
- `ConflictError` — pytanie ma powiązane rekordy `attempts`

---

## 4. Szczegóły odpowiedzi

| Scenariusz | Kod statusu | Ciało |
|---|---|---|
| Pomyślne usunięcie | `204 No Content` | brak |
| Nieprawidłowe UUID w parametrze | `400 Bad Request` | `{ "error": "Validation failed", "issues": [...] }` |
| Brak autoryzacji | `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| Pytanie nie znalezione / nie należy do użytkownika | `404 Not Found` | `{ "error": "..." }` |
| Pytanie ma powiązane rekordy attempts | `409 Conflict` | `{ "error": "..." }` |
| Nieoczekiwany błąd serwera | `500 Internal Server Error` | `{ "error": "Internal server error" }` |

---

## 5. Przepływ danych

```
DELETE /api/questions/:id
        │
        ▼
[id].ts — DELETE handler
  1. Weryfikacja sesji użytkownika (locals.user → 401 jeśli brak)
  2. Walidacja params.id przez Zod (UUID) → 400 jeśli nieprawidłowe
  3. Wywołanie deleteQuestion(supabase, userId, id)
        │
        ▼
questions.service.ts — deleteQuestion()
  4. Sprawdzenie istnienia pytania dla userId
     (SELECT id FROM questions WHERE id = ? AND user_id = ?)
     → NotFoundError jeśli brak
  5. Sprawdzenie istnienia powiązanych attempts
     (SELECT count FROM attempts WHERE question_id = ?)
     → ConflictError jeśli count > 0
  6. Usunięcie pytania
     (DELETE FROM questions WHERE id = ? AND user_id = ?)
     → kaskadowe usunięcie question_categories, question_tags, question_edits
        │
        ▼
[id].ts — powrót do handlera
  7. Return 204 No Content
```

Cascading deletes obsługiwane przez FK z `ON DELETE CASCADE` w tabelach:
- `question_categories.question_id → questions.id`
- `question_tags.question_id → questions.id`
- `question_edits.question_id → questions.id`

Tabela `attempts` ma FK `attempts_question_id_fkey → questions.id` — zgodnie z wymaganiami API sprawdzenie wykonywane jest w warstwie serwisu (jawnie), przed próbą usunięcia.

---

## 6. Względy bezpieczeństwa

- **Uwierzytelnianie:** obowiązkowe — brak sesji (`locals.user`) zwraca `401`. Klient Supabase pochodzi z `context.locals.supabase` (nigdy bezpośrednio importowany w route).
- **Autoryzacja:** RLS (`row level security`) na tabeli `questions` zapewnia, że użytkownik może usunąć wyłącznie własne pytania. Dodatkowe sprawdzenie w serwisie poprzez `eq("user_id", userId)` zapobiega wyciekom informacji przez różnicę odpowiedzi (user A nie może stwierdzić istnienia pytania usera B — oba przypadki zwracają `404`).
- **Walidacja wejścia:** `id` walidowany przez Zod (`z.string().uuid()`) przed jakimkolwiek zapytaniem do bazy.
- **IDOR:** brak możliwości usunięcia cudzego pytania dzięki RLS + filtrowi `user_id`.

---

## 7. Obsługa błędów

| Źródło błędu | Typ błędu | Kod HTTP |
|---|---|---|
| Nieprawidłowy UUID w `params.id` | Zod `ZodError` | `400` |
| Brak sesji użytkownika | — | `401` |
| Pytanie nie istnieje lub brak dostępu | `NotFoundError` | `404` |
| Pytanie posiada powiązane attempts | `ConflictError` | `409` |
| Błąd Supabase / nieoczekiwany wyjątek | generic `Error` | `500` |

Nieoczekiwane błędy logowane przez `console.error` z kontekstem `{ userId, id, err }`.

---

## 8. Rozważania dotyczące wydajności

- Sprawdzenie attempts wykonywane osobnym `SELECT count(*)` z `head: true` — nie pobiera danych, tylko sprawdza istnienie.
- Sprawdzenie istnienia pytania i sprawdzenie attempts można zrealizować w jednym zapytaniu lub za pomocą `Promise.all` by zrównoleglić oba SELECTy — preferowane ze względu na mniejsze opóźnienia.
- Usunięcie pytania jest atomowe na poziomie bazy danych; kaskadowe usunięcia realizowane przez PostgreSQL w jednej transakcji.
- Indeksy: `questions(id, user_id)` i `attempts(question_id)` powinny istnieć (patrz migracja `20260321120000_questions_list_indexes.sql`).

---

## 9. Etapy wdrożenia

1. **Serwis — `src/lib/services/questions.service.ts`**
   - Dodaj funkcję `deleteQuestion(supabase: SupabaseClientType, userId: string, id: string): Promise<void>`.
   - W równoległych zapytaniach (`Promise.all`) sprawdź:
     - Czy pytanie istnieje dla `userId` (SELECT z `maybeSingle()`).
     - Ile rekordów `attempts` istnieje dla `question_id = id` (SELECT z `{ count: "exact", head: true }`).
   - Jeśli pytanie nie znalezione → `throw new NotFoundError(...)`.
   - Jeśli `attempts_count > 0` → `throw new ConflictError("Question has existing attempt records.")`.
   - Wykonaj `DELETE FROM questions WHERE id = ? AND user_id = ?`.
   - Obsłuż ewentualny błąd Supabase i przerzuć go dalej.

2. **Route — `src/pages/api/questions/[id].ts`**
   - Dodaj eksport `DELETE: APIRoute`.
   - Pobierz `user` z `locals.user`; jeśli brak → `return 401`.
   - Waliduj `params` przez istniejący `ParamsSchema` (UUID).
   - Wywołaj `await deleteQuestion(locals.supabase, locals.user.id, parsed.data.id)`.
   - Złap `NotFoundError` → `return 404`, `ConflictError` → `return 409`.
   - Złap pozostałe błędy → `console.error` + `return 500`.
   - Przy sukcesie → `return new Response(null, { status: 204 })`.

3. **Weryfikacja**
   - Upewnij się, że dla tabel `question_categories`, `question_tags`, `question_edits` zdefiniowany jest `ON DELETE CASCADE` w migracjach Supabase.
   - Uruchom `npm run lint` i popraw ewentualne błędy ESLint.
