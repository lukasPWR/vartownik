# API Endpoint Implementation Plan: POST /api/questions

## 1. Przegląd punktu końcowego

Endpoint umożliwia uwierzytelnionemu użytkownikowi ręczne (manual) dodanie nowego pytania do swojej puli. Tworzy rekord w tabeli `questions` (z `generated_type = "manual"`, `status = "active"`), a następnie wiąże go z kategoriami i tagami przez tabele pośrednie `question_categories` i `question_tags`. Przed zapisem weryfikuje unikalność treści pytania (pole `content_hash`) oraz limit przechowywanych pytań zdefiniowany w `user_preferences`.

---

## 2. Szczegóły żądania

- **Metoda HTTP:** `POST`
- **Struktura URL:** `/api/questions`
- **Content-Type:** `application/json`

### Parametry

**Wymagane (cookie):**
- sesja użytkownika — cookie Supabase SSR (dostarczana automatycznie przez middleware → `locals.user`)

**Request Body:**

| Pole | Typ | Wymagane | Opis |
|------|-----|----------|------|
| `question_text` | string | Tak | Treść pytania (10–1000 znaków) |
| `correct_answer.primary` | string | Tak | Główna poprawna odpowiedź (1–200 znaków) |
| `correct_answer.synonyms` | string[] | Nie | Synonimy akceptowane jako poprawna odpowiedź (max 10 elementów, każdy max 200 znaków); domyślnie `[]` |
| `difficulty_score` | integer | Tak | Trudność 1–5 |
| `category_ids` | string[] | Tak | Tablica UUID istniejących kategorii należących do użytkownika (min 1 element) |
| `tag_ids` | string[] | Nie | Tablica UUID istniejących tagów należących do użytkownika (może być pusta); domyślnie `[]` |
| `image_path` | string \| null | Nie | Ścieżka do obrazka w Supabase Storage; domyślnie `null` |

---

## 3. Wykorzystywane typy

Wszystkie typy są już zdefiniowane w `src/types.ts`. Nie jest wymagane tworzenie nowych.

```typescript
import type {
  CreateQuestionCommand, // input DTO — POST body
  QuestionDTO,           // output DTO — 201 response
  CorrectAnswerDTO,      // { primary: string; synonyms: string[] }
  CategoryRefDTO,        // { id: string; name: string }
  GeneratedType,         // 'manual' | 'ai'
  QuestionStatus,        // 'active' | ...
} from "@/types";
```

Lokalny Zod-inferred typ `CreateQuestionBody` definiowany wewnątrz pliku route — nie wymaga eksportu do `types.ts`.

---

## 4. Szczegóły odpowiedzi

### 201 Created

```json
{
  "id": "uuid",
  "generated_type": "manual",
  "status": "active",
  "question_text": "Który piłkarz strzelił ...",
  "correct_answer": { "primary": "Robert Lewandowski", "synonyms": ["Lewandowski", "RL9"] },
  "difficulty_score": 3,
  "image_path": null,
  "source_model": null,
  "categories": [{ "id": "uuid", "name": "Ekstraklasa" }],
  "tags": [],
  "created_at": "2026-03-21T10:00:00Z"
}
```

### Kody statusu

| Kod | Sytuacja |
|-----|----------|
| 201 | Pytanie zostało pomyślnie utworzone |
| 400 | Nieprawidłowe dane wejściowe (błąd Zod) lub ciało żądania nie jest poprawnym JSON |
| 401 | Brak lub nieważna sesja użytkownika |
| 409 | Pytanie z identyczną treścią już istnieje dla tego użytkownika (duplikat `content_hash`) |
| 422 | Osiągnięto limit liczby pytań (`user_preferences.storage_limit_questions`) |
| 500 | Nieoczekiwany błąd po stronie serwera |

---

## 5. Przepływ danych

```
HTTP POST /api/questions  { body: CreateQuestionCommand }
  │
  ▼
[src/pages/api/questions/index.ts]  ← Astro API route (export const POST)
  1. Sprawdź locals.user → 401 jeśli brak
  2. Parsuj ciało żądania (request.json()) → 400 jeśli niepoprawny JSON
  3. Waliduj body przez Zod (CreateQuestionBodySchema) → 400 przy błędach
  │
  ▼
[src/lib/services/questions.service.ts]  (nowa funkcja createQuestion)
  4. Pobierz user_preferences (storage_limit_questions) dla user_id
  5. Zlicz bieżące pytania użytkownika (.count())
  6. Jeśli count >= storage_limit → rzuć StorageLimitError → 422
  7. Oblicz content_hash = SHA-256(userId + question_text) jako hex string
  8. Wstaw rekord do `questions`:
       { question_text, correct_answer, difficulty_score, image_path,
         generated_type: "manual", status: "active",
         content_hash, user_id, source_model: null }
     → 409 przy naruszeniu unique constraint na (user_id, content_hash)
  9. Jeśli category_ids.length > 0:
       Wstaw rekordy do `question_categories` [ { question_id, category_id } ]
  10. Jeśli tag_ids.length > 0:
       Wstaw rekordy do `question_tags` [ { question_id, tag_id } ]
  11. Pobierz pełne dane pytania z kategorami i tagami (SELECT ze złączeniami)
  12. Zmapuj wynik na QuestionDTO i zwróć
  │
  ▼
[src/pages/api/questions/index.ts]
  13. Zwróć Response 201 z JSON (QuestionDTO)
```

### Szczegóły operacji bazodanowych

#### Krok 4–6: Sprawdzenie limitu

```typescript
const { data: prefs } = await supabase
  .from("user_preferences")
  .select("storage_limit_questions")
  .eq("user_id", userId)
  .maybeSingle();

const { count } = await supabase
  .from("questions")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId);

if ((count ?? 0) >= (prefs?.storage_limit_questions ?? 0)) {
  throw new StorageLimitError("Question storage limit reached");
}
```

#### Krok 7: Obliczanie content_hash

```typescript
import { createHash } from "node:crypto";
const content_hash = createHash("sha256")
  .update(`${userId}::${question_text.trim()}`)
  .digest("hex");
```

#### Krok 8: Insert pytania

```typescript
const { data: inserted, error } = await supabase
  .from("questions")
  .insert({
    question_text: command.question_text,
    correct_answer: command.correct_answer as Json,
    difficulty_score: command.difficulty_score,
    image_path: command.image_path ?? null,
    generated_type: "manual",
    status: "active",
    content_hash,
    user_id: userId,
    source_model: null,
  })
  .select("id, created_at")
  .single();
```

#### Krok 9–10: Insert relacji (batch)

```typescript
if (command.category_ids.length > 0) {
  await supabase.from("question_categories").insert(
    command.category_ids.map((cid) => ({ question_id: id, category_id: cid }))
  );
}
if (command.tag_ids.length > 0) {
  await supabase.from("question_tags").insert(
    command.tag_ids.map((tid) => ({ question_id: id, tag_id: tid }))
  );
}
```

#### Krok 11: Pobranie pełnych danych z JOIN

```typescript
const { data } = await supabase
  .from("questions")
  .select(`
    id, generated_type, status, question_text, correct_answer,
    difficulty_score, image_path, source_model, created_at,
    question_categories(categories(id, name)),
    question_tags(tags(id, name))
  `)
  .eq("id", id)
  .single();
```

---

## 6. Względy bezpieczeństwa

### Uwierzytelnianie i autoryzacja

- Sprawdzenie `locals.user` na początku handlera (`401` jeśli brak)
- `user_id` pochodzi wyłącznie z `locals.user.id` (z sesji SSR), nigdy z treści żądania
- RLS w Supabase zapewnia dodatkową warstwę ochrony — użytkownik nie może zapisywać do cudzych rekordów

### Walidacja danych wejściowych

- Wszystkie dane wejściowe walidowane przez Zod przed jakąkolwiek operacją DB
- `category_ids` i `tag_ids` to UUID — Zod weryfikuje format (`z.string().uuid()`)
- Właścicielstwo `category_ids` i `tag_ids` weryfikowane pośrednio przez RLS (insert do junction table zakończy się błędem FK jeśli kategoria/tag nie należy do usera). Dla bardziej precyzyjnych błędów zaleca się dodatkowe sprawdzenie przed insertem
- `image_path` akceptuje tylko ścieżki (nie pełne URL) — walidacja przez Zod (`z.string().regex(...)` lub brak protokołu HTTP)

### Integralność danych

- `content_hash` obliczany server-side — klient nie może go podsunąć
- `generated_type: "manual"` i `status: "active"` ustawiane hard-coded — klient nie może ich nadpisać
- `source_model: null` ustawiane hard-coded dla pytań manualnych

### Inne

- Brak SSRF: `image_path` jest ścieżką w Supabase Storage, nie URL do zewnętrznych zasobów
- Brak mass assignment: tylko whitelisted pola z command są zapisywane do DB

---

## 7. Obsługa błędów

| Sytuacja | Źródło | Kod statusu | Odpowiedź |
|----------|--------|-------------|-----------|
| Brak sesji użytkownika | middleware / `locals.user` | 401 | `{ "error": "Unauthorized" }` |
| Body nie jest poprawnym JSON | `request.json()` throw | 400 | `{ "error": "Request body must be valid JSON" }` |
| Naruszenie schematu Zod | `safeParse` | 400 | `{ "error": "Validation failed", "issues": [...] }` |
| Limit pytań osiągnięty | `StorageLimitError` | 422 | `{ "error": "Question storage limit reached" }` |
| Duplikat treści pytania | Supabase unique constraint | 409 | `{ "error": "A question with this content already exists" }` |
| FK violation (zły category_id / tag_id) | Supabase error code `23503` | 400 | `{ "error": "One or more category_ids or tag_ids are invalid" }` |
| Nieoczekiwany błąd DB | `catch (err)` | 500 | `{ "error": "Internal server error" }` + `console.error` |

### Identyfikacja błędu duplikatu

Supabase zwraca error code `23505` dla naruszenia unikalnego klucza:

```typescript
if (error.code === "23505") {
  throw new ConflictError("A question with this content already exists");
}
```

---

## 8. Rozważania dotyczące wydajności

- **Limit check przed insert:** Dwa szybkie zapytania (SELECT maybeSingle na preferencjach + count na questions) przed kosztownym insert — wczesne odrzucenie przy przekroczonym limicie
- **Batch insert relacji:** Wstawianie wszystkich `question_categories` i `question_tags` w jednym `.insert([...])` zamiast pętli
- **Indeksy:** Kolumna `(user_id, content_hash)` powinna mieć unikalny indeks (wymagany przez constraint `409`). Kolumna `user_id` na `questions` powinna być indeksowana (niezbędne dla czasu odpowiedzi `count`)
- **Brak transakcji:** Supabase JS nie wspiera natywnych transakcji w kliencie — jeśli insert relacji się nie powiedzie po udanym insert pytania, pozostanie osierocony rekord. Rozwiązanie: implementacja jako PostgreSQL function (RPC) lub akceptacja obecnego podejścia i czyszczenie przez mechanizm zewnętrzny / ponowne próby

---

## 9. Etapy implementacji

1. **Rozszerz schemat Zod w `src/pages/api/questions/index.ts`**
   - Dodaj `CreateQuestionBodySchema`:
     - `question_text`: `z.string().min(10).max(1000)`
     - `correct_answer`: `z.object({ primary: z.string().min(1).max(200), synonyms: z.array(z.string().max(200)).max(10).default([]) })`
     - `difficulty_score`: `z.number().int().min(1).max(5)`
     - `category_ids`: `z.array(z.string().uuid()).min(1)`
     - `tag_ids`: `z.array(z.string().uuid()).default([])`
     - `image_path`: `z.string().nullable().optional()`

2. **Dodaj handler `POST` w `src/pages/api/questions/index.ts`**
   - Guard `locals.user` → 401
   - `request.json()` w try/catch → 400
   - `CreateQuestionBodySchema.safeParse(body)` → 400
   - Wywołanie `createQuestion(locals.supabase, locals.user.id, parsed.data)`
   - Mapowanie błędów (`StorageLimitError` → 422, `ConflictError` → 409, catch-all → 500)
   - Return `new Response(JSON.stringify(result), { status: 201 })`

3. **Dodaj klasy błędów do `src/lib/errors.ts`**
   - `StorageLimitError extends Error`
   - `ConflictError extends Error` (jeśli jeszcze nie istnieje)

4. **Zaimplementuj `createQuestion` w `src/lib/services/questions.service.ts`**
   - Signature: `createQuestion(supabase: SupabaseClientType, userId: string, command: CreateQuestionCommand): Promise<QuestionDTO>`
   - Krok A: pobierz `user_preferences.storage_limit_questions` i aktualny `count` pytań użytkownika
   - Krok B: rzuć `StorageLimitError` jeśli przekroczony
   - Krok C: oblicz `content_hash` za pomocą `node:crypto` SHA-256
   - Krok D: insert do `questions` — obsłuż `error.code === "23505"` → `ConflictError`, `23503` → błąd 400
   - Krok E: batch insert do `question_categories` (jeśli `category_ids.length > 0`)
   - Krok F: batch insert do `question_tags` (jeśli `tag_ids.length > 0`)
   - Krok G: SELECT pytania z JOIN `question_categories(categories)` i `question_tags(tags)`
   - Krok H: mapuj na `QuestionDTO` i zwróć

5. **Weryfikacja ręczna (curl / Postman)**
   - 201: prawidłowe dane → pytanie zwrócone z kategorią i tagiem
   - 400: brakujące `question_text`, za krótkie, złe difficulty
   - 401: brak cookie sesji
   - 409: drugi POST z identyczną treścią
   - 422: po przekroczeniu limitu `storage_limit_questions`

6. **Lint & format**
   - `npm run lint:fix`
   - `npm run format`
