# API Endpoint Implementation Plan: PATCH /api/questions/:id

## 1. Przegląd punktu końcowego

Endpoint umożliwia częściową aktualizację pytania należącego do zalogowanego użytkownika. Obsługuje: edycję treści pytania, poprawnej odpowiedzi, poziomu trudności, statusu (w tym flagowanie), powiązanych kategorii oraz tagów. Każda udana aktualizacja automatycznie tworzy rekord audytowy w tabeli `question_edits`. Zwraca pełny obiekt pytania w formacie identycznym z `GET /api/questions/:id`.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `PATCH`
- **Struktura URL:** `/api/questions/:id`
- **Parametry URL:**
  - Wymagane: `id` (UUID pytania)
- **Parametry zapytania:** brak
- **Request Body** (wszystkie pola opcjonalne, ale `change_reason` jest wymagany przez istniejący typ `UpdateQuestionCommand`):

```json
{
  "question_text": "Który piłkarz strzelił ...",
  "correct_answer": { "primary": "Robert Lewandowski", "synonyms": ["Lewandowski"] },
  "difficulty_score": 4,
  "status": "flagged",
  "category_ids": ["uuid"],
  "tag_ids": [],
  "change_reason": "Poprawka treści pytania"
}
```

---

## 3. Wykorzystywane typy

Z `src/types.ts`:

```typescript
/** PATCH /api/questions/:id request body */
export interface UpdateQuestionCommand {
  question_text?: string;
  correct_answer?: Partial<CorrectAnswerDTO>;
  difficulty_score?: number;
  status?: QuestionStatus;
  category_ids?: string[];
  tag_ids?: string[];
  change_reason: string;  // wymagany — pole audytowe
}

/** Zwracany typ odpowiedzi (taki sam jak GET /api/questions/:id) */
export interface QuestionDetailDTO extends QuestionDTO {
  edit_history: QuestionEditHistoryDTO[];
  updated_at: string;
}

export type QuestionStatus = Enums<"question_status_enum">;
// Dozwolone wartości: "active" | "flagged" | "needs_review" | "verified" | "archived"
```

Do budowy rekordu audytowego — pola z `Tables<"question_edits">`:
- `question_id`, `user_id`, `change_reason`, `old_payload` (JSON), `new_payload` (JSON)

---

## 4. Szczegóły odpowiedzi

| Status | Opis |
|--------|------|
| `200 OK` | Pytanie zaktualizowane — zwraca `QuestionDetailDTO` |
| `400 Bad Request` | Błąd walidacji Zod lub brak co najmniej jednego pola do aktualizacji i `change_reason` |
| `401 Unauthorized` | Brak sesji lub wygasły token |
| `404 Not Found` | Pytanie nie istnieje lub należy do innego użytkownika |
| `500 Internal Server Error` | Nieoczekiwany błąd serwera |

**Struktura odpowiedzi 200:**
```json
{
  "id": "uuid",
  "generated_type": "ai",
  "status": "flagged",
  "question_text": "...",
  "correct_answer": { "primary": "...", "synonyms": [] },
  "difficulty_score": 4,
  "image_path": null,
  "source_model": "gpt-4o",
  "categories": [{ "id": "uuid", "name": "Ekstraklasa" }],
  "tags": [],
  "edit_history": [
    { "id": "uuid", "change_reason": "Poprawka treści pytania", "created_at": "..." }
  ],
  "created_at": "...",
  "updated_at": "..."
}
```

---

## 5. Przepływ danych

```
PATCH /api/questions/:id
        │
        ▼
[Astro API Route] src/pages/api/questions/[id].ts
  1. Sprawdź locals.user → 401 jeśli brak
  2. Walidacja params.id (UUID) przez Zod → 400 jeśli niepoprawny
  3. Walidacja request body przez UpdateQuestionBodySchema (Zod) → 400 jeśli błąd
        │
        ▼
[questions.service.ts] updateQuestion(supabase, userId, id, command)
  4. Pobierz bieżący stan pytania (SELECT ... WHERE id=? AND user_id=?)
     → NotFoundError jeśli nie znaleziono (→ 404)
  5. Zbuduj obiekt zmian (tylko dostarczone pola)
  6. Zaktualizuj rekord questions (UPDATE)
  7. Zsynchronizuj question_categories:
     - DELETE stare powiązania (jeśli category_ids dostarczone)
     - INSERT nowe powiązania
  8. Zsynchronizuj question_tags:
     - DELETE stare powiązania (jeśli tag_ids dostarczone)
     - INSERT nowe powiązania
  9. INSERT do question_edits (old_payload, new_payload, change_reason, user_id)
 10. Wywołaj getQuestionById → zwróć QuestionDetailDTO
        │
        ▼
[Astro API Route] — zwróć Response 200 z JSON
```

> **Transakcja:** Kroki 6–9 powinny być wykonane w obrębie jednego zapytania RPC (lub sekwencyjnie z obsługą błędów rollback-like — patrz sekcja Wydajność). Preferowane podejście: sekwencyjne wywołania Supabase z obsługą błędów po każdym z nich.

---

## 6. Względy bezpieczeństwa

1. **Autentykacja:** Sprawdzenie `locals.user` na początku handlera. Zwrócenie `401` przy braku sesji.
2. **Autoryzacja (RLS):** Klient Supabase z sesji SSR (`locals.supabase`) automatycznie stosuje RLS. Klauzula `.eq("user_id", userId)` w zapytaniu SELECT gwarantuje, że użytkownik może aktualizować tylko własne pytania.
3. **Walidacja wejściowa (Zod):**
   - `id` — `z.string().uuid()`
   - `question_text` — `z.string().min(10).optional()`
   - `correct_answer` — `z.object({ primary: z.string().min(1), synonyms: z.array(z.string()).optional() }).optional()`
   - `difficulty_score` — `z.number().int().min(1).max(5).optional()`
   - `status` — `z.enum(["active","flagged","needs_review","verified","archived"]).optional()`
   - `category_ids` — `z.array(z.string().uuid()).optional()`
   - `tag_ids` — `z.array(z.string().uuid()).optional()`
   - `change_reason` — `z.string().min(1).max(500)` (wymagany)
4. **Brak pól do aktualizacji:** jeśli żadne z pól pytania nie jest dostarczone (tylko `change_reason`), należy zwrócić `400 Bad Request` z komunikatem "No fields to update provided".
5. **Ochrona przed mass-assignment:** service przyjmuje silnie typowany `UpdateQuestionCommand`, a nie surowy `body`.
6. **UUID category_ids / tag_ids:** błędy klucza obcego z Supabase (PostgreSQL `23503`) należy mapować na `400 Bad Request`.
7. **Klucz API OpenRouter:** nieużywany w tym endpoincie — nie dotyczy.

---

## 7. Obsługa błędów

| Scenariusz | Kod błędu Supabase/Node | Odpowiedź HTTP |
|---|---|---|
| Brak/wygasła sesja | — | `401 Unauthorized` |
| Niepoprawny UUID w `params.id` | Zod parse error | `400 Bad Request` |
| Błąd walidacji body | Zod parse error | `400 Bad Request` |
| Brak pól do aktualizacji | logika w serwisie | `400 Bad Request` |
| Pytanie nie istnieje / nie należy do usera | `PGRST116` / `NotFoundError` | `404 Not Found` |
| Niepoprawne `category_ids` lub `tag_ids` | PostgreSQL `23503` (FK violation) | `400 Bad Request` |
| Nieoczekiwany błąd DB | inne | `500 Internal Server Error` |

Błąd `500` powinien być logowany przez `console.error` z kontekstem (`userId`, `id`, `err`), zgodnie z wzorcem z `GET /api/questions/:id`.

---

## 8. Rozważania dotyczące wydajności

1. **Minimalizacja zapytań:** Pobierz bieżący stan pytania **i** zaktualizuj go w dwóch operacjach (SELECT + UPDATE). Unikaj dodatkowych SELECTów jeśli to możliwe.
2. **Synchronizacja relacji:** Dla `category_ids` i `tag_ids` użyj operacji DELETE + INSERT zamiast porównania diff — jest prostsze i nie stwarza ryzyka race condition.
3. **Ostateczny fetch:** Po aktualizacji wywołaj istniejącą funkcję `getQuestionById`, która pobiera pełny obiekt z relacjami i historią edycji — DRY, jeden punkt spójności.
4. **Indeksy:** Tabela `questions` posiada indeks na `(id, user_id)` (z migracji `20260321120000_questions_list_indexes.sql`) — zapytania WHERE są szybkie.
5. **Brak transakcji Supabase JS:** Klient JS nie obsługuje transakcji wprost. Sekwencja operacji jest akceptowalna dla tego przypadku, gdyż błąd na etapie INSERT question_edits nie jest krytyczny dla integralności danych (rekord pytania i tak zostanie zaktualizowany). W razie potrzeby można wynieść logikę do funkcji RPC w PostgreSQL.

---

## 9. Etapy wdrożenia

1. **Dodaj `updateQuestion` do `src/lib/services/questions.service.ts`:**
   - Parametry: `(supabase: SupabaseClientType, userId: string, id: string, command: UpdateQuestionCommand): Promise<QuestionDetailDTO>`
   - Sprawdź, czy `command` zawiera co najmniej jedno pole pytania; jeśli nie — rzuć `new Error("NO_FIELDS")` (obsłużone jako 400 w routerze).
   - Pobierz bieżące pytanie przez `getQuestionById` (rzuca `NotFoundError` → 404).
   - Zbuduj `updatePayload` tylko z dostarczonych pól (`question_text`, `correct_answer`, `difficulty_score`, `status`).
   - Wywołaj `.from("questions").update(updatePayload).eq("id", id).eq("user_id", userId)`.
   - Jeśli `command.category_ids` jest dostarczone — usuń stare i wstaw nowe rekordy `question_categories`.
   - Jeśli `command.tag_ids` jest dostarczone — usuń stare i wstaw nowe rekordy `question_tags`.
   - Wstaw rekord audytowy do `question_edits`: `{ question_id: id, user_id: userId, change_reason: command.change_reason, old_payload: <bieżący stan>, new_payload: <nowy stan> }`.
   - Wywołaj `getQuestionById(supabase, userId, id)` i zwróć wynik.

2. **Dodaj handler `PATCH` w `src/pages/api/questions/[id].ts`:**
   - Zdefiniuj schemat Zod `UpdateQuestionBodySchema` z polami z sekcji 6.
   - Waliduj `locals.user` → `401`.
   - Waliduj `params.id` → `400`.
   - Odczytaj i sparsuj `request.json()`, waliduj przez `UpdateQuestionBodySchema` → `400`.
   - Wywołaj `updateQuestion(locals.supabase, locals.user.id, id, body)`.
   - Obsłuż wyjątki: `NotFoundError` → `404`, `Error` z kodem `NO_FIELDS` → `400`, FK violation → `400`, pozostałe → `500` z logowaniem.
   - Zwróć `Response` ze statusem `200` i JSON.

3. **Weryfikacja błędów kluczy obcych:** W serwisie sprawdzaj `error.code === "23503"` przy INSERT do `question_categories` / `question_tags` i rzucaj `new Error("INVALID_RELATION_IDS")` → handler mapuje na `400`.

4. **Testy manualne (lokalne dev):**
   - PATCH z poprawnym body → 200 + zaktualizowany obiekt + nowy rekord w `question_edits`.
   - PATCH z nieznanym `id` → 404.
   - PATCH bez pól pytania (tylko `change_reason`) → 400.
   - PATCH z niepoprawnym UUID w `category_ids` → 400.
   - PATCH z `difficulty_score: 6` → 400 (walidacja Zod).
   - PATCH bez nagłówka sesji → 401.

5. **Weryfikacja lint:** Uruchom `npm run lint` i napraw ewentualne błędy ESLint.
