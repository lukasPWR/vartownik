# API Endpoint Implementation Plan: PATCH /api/attempts/:id

## 1. Przegląd punktu końcowego

Endpoint umożliwia ustawienie samooceny (`verdict`) oraz oznaczenie pytania flagą (`is_flagged_by_user` + `flag_reason`) dla istniejącego wpisu attempt po zakończeniu rundy. Obsługuje przypadki użycia US-004 (samoocena) i US-005 (flagowanie pytania). Operacja jest dozwolona wyłącznie gdy runda nadrzędna ma status inny niż `in_progress`.

## 2. Szczegóły żądania

- **Metoda HTTP:** `PATCH`
- **Struktura URL:** `/api/attempts/:id`
- **Parametry:**
  - Wymagane: `id` — identyfikator attempt (liczba całkowita dodatnia, path param)
  - Opcjonalne: brak parametrów query
- **Request Body (JSON):**

```json
{
  "verdict": "knew" | "did_not_know" | null,
  "is_flagged_by_user": boolean,
  "flag_reason": string | null
}
```

Wszystkie pola body są opcjonalne — klient może wysłać dowolną kombinację. Przynajmniej jedno pole powinno być dostarczone, choć API nie wymusza tego warunkowo (pusta aktualizacja jest idempotentna).

## 3. Wykorzystywane typy

```typescript
// Już zdefiniowane w src/types.ts:

/** Path param po parsowaniu */
type AttemptId = number; // z.coerce.number().int().positive()

/** Enum z database.types.ts */
type AttemptVerdict = "knew" | "did_not_know"; // Enums<"attempt_verdict_enum">

/** Request body — UpdateAttemptCommand (już istnieje) */
interface UpdateAttemptCommand {
  verdict?: AttemptVerdict | null;
  is_flagged_by_user?: boolean;
  flag_reason?: string | null;
}

/** Response body — AttemptDTO (już istnieje, rozszerzyć o flag_reason) */
interface AttemptDTO {
  id: number;
  question_id: string;
  position: number;
  scratchpad: string | null;
  time_taken_ms: number;
  timer_expired: boolean;
  verdict: AttemptVerdict | null;
  is_flagged_by_user: boolean;
  flag_reason: string | null;  // <-- dodać do istniejącego AttemptDTO
  created_at: string;
}
```

> **Uwaga:** `AttemptDTO` w `src/types.ts` nie zawiera pola `flag_reason`. Należy je dołączyć do definicji, ponieważ endpoint odpowiada zaktualizowanym obiektem attempt razem z powodem flagi.

## 4. Szczegóły odpowiedzi

| Status | Opis | Body |
|--------|------|------|
| `200 OK` | Attempt zaktualizowany pomyślnie | Zaktualizowany obiekt `AttemptDTO` (JSON) |
| `400 Bad Request` | Runda nadal `in_progress` lub nieprawidłowa wartość `verdict` | `{ "error": string }` |
| `401 Unauthorized` | Brak zalogowanego użytkownika | `{ "error": "Unauthorized" }` |
| `404 Not Found` | Attempt nie istnieje lub nie należy do użytkownika | `{ "error": "Resource not found." }` |
| `500 Internal Server Error` | Nieoczekiwany błąd serwera | `{ "error": "Internal server error" }` |

## 5. Przepływ danych

```
Żądanie PATCH /api/attempts/:id
  │
  ├─ [1] Astro API route: src/pages/api/attempts/[id].ts
  │       ├─ Weryfikacja auth: locals.user → 401 jeśli brak
  │       ├─ Walidacja path param: z.coerce.number().int().positive()
  │       ├─ Walidacja body: Zod schema (verdict, is_flagged_by_user, flag_reason)
  │       └─ Wywołanie: updateAttempt(supabase, userId, id, command)
  │
  ├─ [2] attempts.service.ts: updateAttempt()
  │       ├─ SELECT attempt + round JOIN WHERE attempt.id = id AND attempt.user_id = userId
  │       │     → 404 jeśli brak wyniku
  │       ├─ Sprawdzenie round.status !== "in_progress"
  │       │     → rzucenie ValidationError jeśli in_progress
  │       ├─ UPDATE attempts SET verdict=?, is_flagged_by_user=?, flag_reason=?
  │       │   WHERE id = id AND user_id = userId
  │       └─ Zwrócenie zaktualizowanego AttemptDTO
  │
  └─ [3] Odpowiedź HTTP 200 z AttemptDTO
```

**Interakcje z bazą danych:**
- Tabela `attempts` — SELECT (weryfikacja + pobranie round_id) + UPDATE
- Tabela `rounds` — SELECT (sprawdzenie statusu rundy przez JOIN lub osobne zapytanie)
- Filtrowanie `user_id` zapewnia izolację danych między użytkownikami

## 6. Względy bezpieczeństwa

1. **Uwierzytelnienie:** Sprawdzenie `locals.user` na początku handlera. Brak użytkownika → `401 Unauthorized` przed jakąkolwiek operacją na DB.

2. **Autoryzacja:** Zapytanie do bazy danych zawsze zawiera `WHERE user_id = locals.user.id`. Nieistniejący lub cudzy attempt zwraca `404` (nie `403`), aby nie ujawniać informacji o zasobie.

3. **Walidacja wejścia (Zod):**
   - `id` z URL: `z.coerce.number().int().positive()` — odrzuca nieliczbowe i ujemne wartości
   - `verdict`: `z.enum(["knew", "did_not_know"]).nullable().optional()` — tylko dozwolone wartości enumu
   - `is_flagged_by_user`: `z.boolean().optional()`
   - `flag_reason`: `z.string().max(500).nullable().optional()` — ograniczenie długości zapobiega nadmiernemu wpisowi

4. **Business rule enforcement:** Sprawdzenie statusu rundy odbywa się w serwisie przed UPDATE, eliminując wyścig przez użycie danych z tego samego zapytania SELECT.

5. **Brak mass assignment:** Tylko pola z `UpdateAttemptCommand` są przekazywane do UPDATE — nigdy bezpośrednio obiekt body.

## 7. Obsługa błędów

| Scenariusz | Typ błędu | Kod HTTP | Akcja |
|------------|-----------|----------|-------|
| Brak `locals.user` | — | `401` | Wczesny return przed DB |
| `id` nie jest liczbą całkowitą | Zod ValidationError | `400` | Zod `.safeParse()` → issues |
| Nieprawidłowe body JSON | SyntaxError | `400` | try/catch na `request.json()` |
| Nieprawidłowa wartość `verdict` | Zod ValidationError | `400` | Zod `.safeParse()` → issues |
| Attempt nie istnieje lub cudzy | NotFoundError | `404` | Rzucony przez serwis |
| Runda nadal `in_progress` | ValidationError (custom) | `400` | Rzucony przez serwis, złapany w route |
| Błąd Supabase / niespodziewany wyjątek | Error | `500` | console.error + ogólny komunikat |

Wzorzec obsługi błędów w route (spójny z istniejącymi endpointami):

```typescript
} catch (err) {
  if (err instanceof NotFoundError) {
    return new Response(JSON.stringify({ error: err.message }), { status: 404, ... });
  }
  if (err instanceof ValidationError) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400, ... });
  }
  console.error("[PATCH /api/attempts/:id] Unexpected error", { userId, attemptId, err });
  return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, ... });
}
```

> Dodać `ValidationError` do `src/lib/errors.ts` jeśli nie istnieje (dla błędów biznesowych typu „runda w toku").

## 8. Rozważania dotyczące wydajności

1. **Jedno zapytanie SELECT z JOIN:** Zamiast dwóch oddzielnych zapytań (attempt + round), użyć jednego SELECT z JOIN na `rounds`, aby pobrać status rundy i zweryfikować właściciela w jednym round-trip do DB.

2. **Indeksy:** Tabela `attempts` powinna mieć indeks na `(id, user_id)` dla szybkiego lookup. Upewnić się, że istnieje też indeks na `round_id` (FK jest zazwyczaj automatycznie indeksowane przez Supabase).

3. **Brak niepotrzebnych odczytów po UPDATE:** Supabase `.update().eq().select()` zwraca zaktualizowany wiersz w jednym zapytaniu — unikać dodatkowego SELECT po UPDATE.

## 9. Etapy wdrożenia

1. **Aktualizacja `AttemptDTO` w `src/types.ts`**
   - Dodać pole `flag_reason: string | null` do interfejsu `AttemptDTO`

2. **Dodanie `ValidationError` do `src/lib/errors.ts`** (jeśli nie istnieje)
   - Klasa dla błędów biznesowych (np. runda nadal `in_progress`)

3. **Utworzenie `src/lib/services/attempts.service.ts`**
   - Eksport funkcji `updateAttempt(supabase: SupabaseClientType, userId: string, attemptId: number, command: UpdateAttemptCommand): Promise<AttemptDTO>`
   - Logika:
     ```
     SELECT attempts.*, rounds.status AS round_status
     FROM attempts
     JOIN rounds ON rounds.id = attempts.round_id
     WHERE attempts.id = attemptId AND attempts.user_id = userId
     ```
   - Jeśli brak wiersza → rzucić `NotFoundError`
   - Jeśli `round_status === "in_progress"` → rzucić `ValidationError("Round is still in progress. Verdict can only be set after round completion.")`
   - Zbudować obiekt update (tylko dostarczone pola z `command`)
   - `supabase.from("attempts").update(updatePayload).eq("id", attemptId).eq("user_id", userId).select().single()`
   - Zmapować wynik DB na `AttemptDTO` i zwrócić

4. **Utworzenie `src/pages/api/attempts/[id].ts`**
   - `export const prerender = false`
   - Zdefiniować schematy Zod:
     ```typescript
     const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });
     const UpdateAttemptBodySchema = z.object({
       verdict: z.enum(["knew", "did_not_know"]).nullable().optional(),
       is_flagged_by_user: z.boolean().optional(),
       flag_reason: z.string().max(500).nullable().optional(),
     });
     ```
   - Eksport `PATCH: APIRoute`:
     1. Sprawdzenie `locals.user` → 401
     2. `ParamsSchema.safeParse(params)` → 400 przy błędzie
     3. `request.json()` w try/catch → 400 przy nieprawidłowym JSON
     4. `UpdateAttemptBodySchema.safeParse(rawBody)` → 400 przy błędzie
     5. Wywołanie `updateAttempt(locals.supabase, locals.user.id, parsed.id, command)`
     6. Obsługa `NotFoundError` → 404, `ValidationError` → 400, inne → 500
     7. Return `200` z zaktualizowanym `AttemptDTO`

5. **Weryfikacja RLS w Supabase**
   - Upewnić się, że tabela `attempts` ma politykę RLS pozwalającą na UPDATE tylko dla `auth.uid() = user_id`
   - Sprawdzić istniejące migracje lub dodać nową w `supabase/migrations/` jeśli brakuje polityki UPDATE

6. **Testy manualne (dev)**
   - Scenariusz happy path: PATCH z prawidłowym `verdict` po zakończeniu rundy → 200
   - Scenariusz błędu: PATCH gdy runda `in_progress` → 400
   - Scenariusz błędu: PATCH z nieistniejącym `id` → 404
   - Scenariusz błędu: PATCH bez tokenu auth → 401
   - Scenariusz błędu: PATCH z `verdict: "unknown_value"` → 400
