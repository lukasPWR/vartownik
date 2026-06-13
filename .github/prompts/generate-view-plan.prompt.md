Jako starszy programista frontendu Twoim zadaniem jest stworzenie szczegółowego planu wdrożenia nowego widoku w aplikacji internetowej. Plan ten powinien być kompleksowy i wystarczająco jasny dla innego programisty frontendowego, aby mógł poprawnie i wydajnie wdrożyć widok.

Najpierw przejrzyj następujące informacje:

1. Product Requirements Document (PRD):
   <prd>
   #file:../../.ai/prd.md
   </prd>

2. Opis widoku:
   <view_description>

### 2.5. Widok gry — Ekran ładowania (Generation Loading)

- **Ścieżka:** `/game` (stan wewnętrzny Vue island: `loading`)
- **Główny cel:** Wizualna „poczekalnia" podczas generowania 40 pytań przez AI (~40s).
- **Kluczowe informacje:**
  - Aktualny status generowania (pending, retry, success/failed)
  - Rotacyjne ciekawostki piłkarskie
  - Pasek postępu lub animacja ładowania
- **Kluczowe komponenty:**
  - **Animacja ładowania** — pulsujący indykator procesu z fazami (np. „Generuję pytania…", „Weryfikuję jakość…", „Przygotowuję rundy…")
  - **Karuzela ciekawostek** — rotacyjne karty z trivia piłkarskim (zmiana co 5-7 sekund)
  - **Komunikat błędu** — wyświetlany w przypadku `422`, `429` lub `502` z opcją ponowienia
  - **Przycisk anulowania** — pozwala wrócić do dashboardu
- **UX / Dostępność / Bezpieczeństwo:**
  - `aria-live="polite"` na statusie generowania
  - Estymowany czas do wyświetlenia (pasek postępu nie liniowy, lecz fazowy)
  - Brak możliwości opuszczenia bez potwierdzenia po rozpoczęciu generowania
- **Mapowanie API:** `POST /api/generation-batches`, `GET /api/generation-batches/:id` (polling), `POST /api/sessions`
- **Mapowanie US:** US-002

---

### 2.6. Widok gry — Pytanie (Quiz Focus Mode)

- **Ścieżka:** `/game` (stan wewnętrzny Vue island: `playing`)
- **Główny cel:** Prezentacja pojedynczego pytania z timerem i scratchpadem w trybie pełnego skupienia.
- **Kluczowe informacje:**
  - Treść pytania
  - Kategoria pytania (badge)
  - Timer odliczający (15-30s)
  - Numer pytania w rundzie (np. „3/10") i numer rundy (np. „Runda 2/4")
  - Scratchpad z odpowiedzią roboczą
- **Kluczowe komponenty:**
  - **Nagłówek rundy** — minimalistyczny: numer rundy + numer pytania + difficulty badge
  - **Blok pytania** — treść pytania z fluid typography (dynamiczne skalowanie czcionki dla długich pytań); opcjonalny obraz z Supabase Storage
  - **Timer** — wizualny pasek/koło odliczające z kolorową progresją (zielony → żółty → czerwony); pulsowanie w ostatnich 5 sekundach; `aria-live="assertive"` poniżej 5s
  - **Scratchpad** — pole tekstowe na odpowiedź roboczą; automatyczne blokowanie po upływie czasu; dostosowanie wysokości na mobile (`visualViewport` API)
  - **Wskaźnik postępu** — kompaktowy stepper lub dots indicator (1-10)
- **UX / Dostępność / Bezpieczeństwo:**
  - **Tryb Focus:** ciemne tło, ukryta nawigacja, brak menu bocznego — zero dystraktorów
  - **Anti-cheat:** blokada zaznaczania tekstu (`user-select: none`), blokada menu kontekstowego (`oncontextmenu`) na treści pytania
  - **beforeunload** guard: ostrzeżenie przed zamknięciem/odświeżeniem karty
  - Automatyczny submit odpowiedzi po upływie timera (`timer_expired: true`)
  - Brak przycisku pauzy
  - `focus-trap` na scratchpadzie — klawiatura nie opuszcza aktywnego pytania
  - Natychmiastowy `POST /api/rounds/:roundId/attempts` po każdym pytaniu
- **Mapowanie API:** `GET /api/sessions/:sessionId/rounds/:position`, `POST /api/rounds/:roundId/attempts`
- **Mapowanie US:** US-003, US-007

---

</view_description>

3. User Stories:
   <user_stories>

### US-002: Generowanie sesji treningowej

- ID: US-002
- Tytuł: Tworzenie zestawu 40 pytań przez AI
- Opis: Jako gracz chcę wygenerować pełny zestaw 40 trudnych pytań jednym kliknięciem, aby móc przejść przez pełny cykl turniejowy bez przerw na ładowanie danych.
- Kryteria akceptacji:

1. System wysyła jeden prompt do modelu AI.
2. AI zwraca 40 pytań podzielonych na 4 rundy.
3. W każdej rundzie kategorie tematyczne są wymieszane.
4. Podczas generowania widoczny jest ekran ładowania z ciekawostkami.
5. Proces trwa nie dłużej niż 40 sekund.

### US-003: Przebieg rundy pod presją

- ID: US-003
- Tytuł: Obsługa pytania z timerem
- Opis: Jako gracz chcę, aby każde pytanie miało odliczany czas i pole scratchpadu, aby symulować stres związany z pisaniem odpowiedzi na kartce podczas turnieju.
- Kryteria akceptacji:

1. Po wyświetleniu pytania timer startuje automatycznie (domyślnie 20s).
2. Użytkownik może wpisać tekst w scratchpad.
3. Po upływie czasu pole edycji zostaje zablokowane.
4. Brak przycisku pauzy na ekranie gry.
5. Prawidłowa odpowiedź pozostaje ukryta do końca rundy.

### US-007: Obsługa skrajnych przypadków (Przerwanie gry)

- ID: US-007
- Tytuł: Reakcja na odświeżenie strony
- Opis: Jako twórca systemu chcę, aby odświeżenie strony unieważniało trwającą rundę, co zapobiega oszukiwaniu poprzez resetowanie timera.
- Kryteria akceptacji:

1. W trakcie aktywnej rundy nie jest zapisywany stan tymczasowy w LocalStorage/DB.
2. Odświeżenie strony skutkuje powrotem do ekranu głównego (Dashboardu).
3. Wyniki z niedokończonej rundy nie są wliczane do statystyk ogólnych.

   </user_stories>

4. Endpoint Description:
   <endpoint_description>

### 2.1 Generation Batches

#### `POST /api/generation-batches`

Trigger AI generation of a full quiz (40 questions / 4 rounds). Calls OpenRouter server-side. Implements the retry mechanism (max 2 attempts) on invalid JSON responses.

**Request body:**

```json
{
  "model": "gpt-4o",
  "provider": "openrouter",
  "prompt_version": "v1",
  "requested_questions_count": 40
}
```

**Response `201`:**

```json
{
  "id": "uuid",
  "status": "pending",
  "model": "gpt-4o",
  "provider": "openrouter",
  "prompt_version": "v1",
  "requested_questions_count": 40,
  "returned_questions_count": 0,
  "retry_count": 0,
  "estimated_cost_usd": null,
  "created_at": "2026-03-21T10:00:00Z"
}
```

**Response `202`** (returned when status becomes `success` after synchronous inline wait, includes created question IDs grouped by round):

```json
{
  "id": "uuid",
  "status": "success",
  "returned_questions_count": 40,
  "retry_count": 0,
  "estimated_cost_usd": 0.012345,
  "finished_at": "2026-03-21T10:00:28Z",
  "rounds": [
    { "position": 1, "question_ids": ["uuid", "..."] },
    { "position": 2, "question_ids": ["uuid", "..."] },
    { "position": 3, "question_ids": ["uuid", "..."] },
    { "position": 4, "question_ids": ["uuid", "..."] }
  ]
}
```

**Errors:**

- `400 Bad Request` — invalid model or prompt version
- `422 Unprocessable Entity` — AI returned malformed JSON after max retries
- `429 Too Many Requests` — rate limit exceeded for generation endpoint
- `502 Bad Gateway` — upstream OpenRouter API error

---

#### `GET /api/generation-batches/:id`

Poll status of a generation batch.

**Response `200`:**

```json
{
  "id": "uuid",
  "status": "success | pending | failed",
  "returned_questions_count": 40,
  "retry_count": 1,
  "estimated_cost_usd": 0.012345,
  "error_message": null,
  "finished_at": "2026-03-21T10:00:28Z"
}
```

**Errors:**

- `404 Not Found` — batch not found or belongs to another user

---

#### `GET /api/generation-batches`

List user's generation batches.

**Query params:** `page`, `limit`, `status` (`pending | success | failed`)

**Response `200`:**

```json
{
  "data": [ { ...batch } ],
  "pagination": { "page": 1, "limit": 20, "total": 7 }
}
```

---

#### `POST /api/sessions`

Start a new training session linked to a successfully completed generation batch.

**Request body:**

```json
{
  "generation_batch_id": "uuid",
  "timer_seconds": 20
}
```

**Response `201`:**

```json
{
  "id": "uuid",
  "status": "in_progress",
  "generation_batch_id": "uuid",
  "timer_seconds": 20,
  "total_rounds": 4,
  "questions_per_round": 10,
  "started_at": "2026-03-21T10:00:00Z",
  "rounds": [
    { "id": "uuid", "position": 1, "status": "in_progress" },
    { "id": "uuid", "position": 2, "status": "in_progress" },
    { "id": "uuid", "position": 3, "status": "in_progress" },
    { "id": "uuid", "position": 4, "status": "in_progress" }
  ]
}
```

**Errors:**

- `400 Bad Request` — `timer_seconds` out of [15, 30] range
- `404 Not Found` — batch not found
- `422 Unprocessable Entity` — batch status is not `success`

> **Note:** Server-side trigger automatically sets any existing `in_progress` sessions for the user to `abandoned` before inserting the new session.

---

#### `GET /api/sessions`

List past sessions for dashboard (US-006).

**Query params:** `page`, `limit`, `status` (`in_progress | completed | abandoned`)

**Response `200`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "status": "completed",
      "timer_seconds": 20,
      "total_rounds": 4,
      "questions_per_round": 10,
      "started_at": "2026-03-21T10:00:00Z",
      "completed_at": "2026-03-21T10:25:00Z",
      "score_summary": {
        "total_questions": 40,
        "knew_count": 28,
        "did_not_know_count": 12,
        "accuracy_percent": 70
      }
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 23 }
}
```

---

#### `GET /api/sessions/:id`

Get a session with round summaries.

**Response `200`:** Full session object including round statuses and score summary

**Errors:**

- `404 Not Found`

---

</endpoint_description>

7. Type Definitions:
   <type_definitions>
   #file:../../src/types.ts
   </type_definitions>

8. Tech Stack:
   <tech_stack>
   #file:../../.ai/tech-stack.md
   </tech_stack>

Przed utworzeniem ostatecznego planu wdrożenia przeprowadź analizę i planowanie wewnątrz tagów <implementation_breakdown> w swoim bloku myślenia. Ta sekcja może być dość długa, ponieważ ważne jest, aby być dokładnym.

W swoim podziale implementacji wykonaj następujące kroki:

1. Dla każdej sekcji wejściowej (PRD, User Stories, Endpoint Description, Endpoint Implementation, Type Definitions, Tech Stack):

- Podsumuj kluczowe punkty
- Wymień wszelkie wymagania lub ograniczenia
- Zwróć uwagę na wszelkie potencjalne wyzwania lub ważne kwestie

2. Wyodrębnienie i wypisanie kluczowych wymagań z PRD
3. Wypisanie wszystkich potrzebnych głównych komponentów, wraz z krótkim opisem ich opisu, potrzebnych typów, obsługiwanych zdarzeń i warunków walidacji
4. Stworzenie wysokopoziomowego diagramu drzewa komponentów
5. Zidentyfikuj wymagane DTO i niestandardowe typy ViewModel dla każdego komponentu widoku. Szczegółowo wyjaśnij te nowe typy, dzieląc ich pola i powiązane typy.
6. Zidentyfikuj potencjalne zmienne stanu i niestandardowe hooki, wyjaśniając ich cel i sposób ich użycia
7. Wymień wymagane wywołania API i odpowiadające im akcje frontendowe
8. Zmapuj każdej historii użytkownika do konkretnych szczegółów implementacji, komponentów lub funkcji
9. Wymień interakcje użytkownika i ich oczekiwane wyniki
10. Wymień warunki wymagane przez API i jak je weryfikować na poziomie komponentów
11. Zidentyfikuj potencjalne scenariusze błędów i zasugeruj, jak sobie z nimi poradzić
12. Wymień potencjalne wyzwania związane z wdrożeniem tego widoku i zasugeruj możliwe rozwiązania

Po przeprowadzeniu analizy dostarcz plan wdrożenia w formacie Markdown z następującymi sekcjami:

1. Przegląd: Krótkie podsumowanie widoku i jego celu.
2. Routing widoku: Określenie ścieżki, na której widok powinien być dostępny.
3. Struktura komponentów: Zarys głównych komponentów i ich hierarchii.
4. Szczegóły komponentu: Dla każdego komponentu należy opisać:

- Opis komponentu, jego przeznaczenie i z czego się składa
- Główne elementy HTML i komponenty dzieci, które budują komponent
- Obsługiwane zdarzenia
- Warunki walidacji (szczegółowe warunki, zgodnie z API)
- Typy (DTO i ViewModel) wymagane przez komponent
- Propsy, które komponent przyjmuje od rodzica (interfejs komponentu)

5. Typy: Szczegółowy opis typów wymaganych do implementacji widoku, w tym dokładny podział wszelkich nowych typów lub modeli widoku według pól i typów.
6. Zarządzanie stanem: Szczegółowy opis sposobu zarządzania stanem w widoku, określenie, czy wymagany jest customowy hook.
7. Integracja API: Wyjaśnienie sposobu integracji z dostarczonym punktem końcowym. Precyzyjnie wskazuje typy żądania i odpowiedzi.
8. Interakcje użytkownika: Szczegółowy opis interakcji użytkownika i sposobu ich obsługi.
9. Warunki i walidacja: Opisz jakie warunki są weryfikowane przez interfejs, których komponentów dotyczą i jak wpływają one na stan interfejsu
10. Obsługa błędów: Opis sposobu obsługi potencjalnych błędów lub przypadków brzegowych.
11. Kroki implementacji: Przewodnik krok po kroku dotyczący implementacji widoku.

Upewnij się, że Twój plan jest zgodny z PRD, historyjkami użytkownika i uwzględnia dostarczony stack technologiczny.

Ostateczne wyniki powinny być w języku polskim i zapisane w pliku o nazwie .ai/{module-name}/{view-name}-view-implementation-plan.md. Nie uwzględniaj żadnej analizy i planowania w końcowym wyniku.

Oto przykład tego, jak powinien wyglądać plik wyjściowy (treść jest do zastąpienia):

```markdown
# Plan implementacji widoku [Nazwa widoku]

## 1. Przegląd

[Krótki opis widoku i jego celu]

## 2. Routing widoku

[Ścieżka, na której widok powinien być dostępny]

## 3. Struktura komponentów

[Zarys głównych komponentów i ich hierarchii]

## 4. Szczegóły komponentów

### [Nazwa komponentu 1]

- Opis komponentu [opis]
- Główne elementy: [opis]
- Obsługiwane interakcje: [lista]
- Obsługiwana walidacja: [lista, szczegółowa]
- Typy: [lista]
- Propsy: [lista]

### [Nazwa komponentu 2]

[...]

## 5. Typy

[Szczegółowy opis wymaganych typów]

## 6. Zarządzanie stanem

[Opis zarządzania stanem w widoku]

## 7. Integracja API

[Wyjaśnienie integracji z dostarczonym endpointem, wskazanie typów żądania i odpowiedzi]

## 8. Interakcje użytkownika

[Szczegółowy opis interakcji użytkownika]

## 9. Warunki i walidacja

[Szczegółowy opis warunków i ich walidacji]

## 10. Obsługa błędów

[Opis obsługi potencjalnych błędów]

## 11. Kroki implementacji

1. [Krok 1]
2. [Krok 2]
3. [...]
```

Rozpocznij analizę i planowanie już teraz. Twój ostateczny wynik powinien składać się wyłącznie z planu wdrożenia w języku polskim w formacie markdown, który zapiszesz w pliku .ai/{module-name}/{view-name}-view-implementation-plan.md i nie powinien powielać ani powtarzać żadnej pracy wykonanej w podziale implementacji.
