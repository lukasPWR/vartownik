# Plan implementacji widoku Gry (`/game`)

## 1. Przegląd

Widok `/game` to główne centrum rozgrywki VARtownika. Jest to pojedynczy, serwerowo-renderowany plik Astro (`src/pages/game.astro`), który montuje jedną dużą, interaktywną wyspę Vue (`GameView.vue`). Cały przepływ rozgrywki zarządzany jest przez maszynę stanów wewnątrz tej wyspy — bez przeładowania strony.

Widok obejmuje dwa główne stany wizualne:

1. **`loading`** — ekran ładowania wyświetlany podczas generowania 40 pytań przez AI (US-002). Obejmuje animację fazową, rotacyjną karuzelę ciekawostek piłkarskich oraz obsługę błędów (422, 429, 502).
2. **`playing`** — tryb pełnego skupienia (Focus Mode) prezentujący jedno pytanie z timerem i scratchpadem (US-003). Ukrywa całą nawigację, wdraża mechanizmy anti-cheat i guard przed opuszczeniem strony (US-007).

## 2. Routing widoku

- **Ścieżka:** `/game`
- **Plik Astro:** `src/pages/game.astro`
- **Ochrona:** Middleware przekierowuje niezalogowanych użytkowników do `/auth/signin`. Zalogowany użytkownik (`context.locals.user`) musi być dostępny.
- **Astro renderuje** szkielet strony (layout bez topbaru/nawigacji w trybie `playing`) i przekazuje `userId` do wyspy Vue przez props.

## 3. Struktura komponentów

```
src/pages/game.astro
└── GameView.vue                          ← główna wyspa Vue, maszyna stanów
    ├── [stan: loading]
    │   └── GenerationLoadingScreen.vue
    │       ├── LoadingPhaseIndicator.vue  ← animacja fazowa
    │       ├── FootballFactCarousel.vue   ← rotacyjna karuzela ciekawostek
    │       └── GenerationErrorMessage.vue ← błędy 422/429/502 + retry
    └── [stan: playing]
        └── QuizFocusMode.vue
            ├── RoundHeader.vue            ← nr rundy, nr pytania, difficulty badge
            ├── QuestionBlock.vue          ← treść pytania + opcjonalny obraz
            ├── TimerWidget.vue            ← odliczanie z kolorową progresją
            ├── Scratchpad.vue             ← pole tekstowe na odpowiedź
            └── QuestionProgressIndicator.vue ← stepper 1-10
```

## 4. Szczegóły komponentów

### `GameView.vue`

- **Opis:** Główna wyspa Vue zarządzająca logiką przepływu gry. Trzyma globalny stan maszyny stanów (`loading` | `playing`), dane sesji i aktualnego pytania. Odpowiada za inicjację generowania, polling statusu batcha, tworzenie sesji i nawigację między pytaniami.
- **Główne elementy:** Warunkowe renderowanie `GenerationLoadingScreen` lub `QuizFocusMode` zależnie od `gameState`. Brak własnych widocznych elementów HTML — to kontener logiczny.
- **Obsługiwane interakcje:**
  - Montowanie (`onMounted`): uruchamia generowanie (`POST /api/generation-batches`), rejestruje `beforeunload` guard
  - Odbiór zdarzenia `@cancel` od `GenerationLoadingScreen` → `navigateToDashboard()`
  - Odbiór zdarzenia `@retry` od `GenerationLoadingScreen` → restart generowania
  - Odbiór zdarzenia `@answer-submitted` od `QuizFocusMode` → przejście do następnego pytania lub stanu podsumowania rundy
  - Odmontowanie (`onUnmounted`): usuwa `beforeunload` guard, czyści polling interval
- **Obsługiwana walidacja:**
  - `POST /api/generation-batches` zwraca 201 (pending) lub 202 (success) — obsługa obu przypadków
  - Polling przerywa po `status === "success"` lub `status === "failed"`
  - `POST /api/sessions` wymaga `generation_batch_id` z zakończonego (success) batcha
- **Typy:** `GameState`, `GenerationBatchCreatedDTO`, `GenerationBatchSuccessDTO`, `GenerationBatchDTO`, `SessionCreatedDTO`, `RoundDTO`
- **Propsy:** brak (dane pobierane bezpośrednio w komponencie na `onMounted`)

---

### `GenerationLoadingScreen.vue`

- **Opis:** Ekran "poczekalni" wyświetlany podczas generowania quizu. Prezentuje aktualną fazę generowania, rotacyjne ciekawostki i ewentualny błąd. Posiada region `aria-live="polite"` na status fazowy.
- **Główne elementy:**
  - `<div role="status" aria-live="polite">` — komunikat o aktualnej fazie
  - `<LoadingPhaseIndicator>` — animowany wskaźnik faz
  - `<FootballFactCarousel>` — karuzela ciekawostek
  - `<GenerationErrorMessage>` — warunkowo, gdy `props.hasError`
  - `<Button variant="ghost">` — „Anuluj i wróć do dashboardu"
- **Obsługiwane interakcje:**
  - Kliknięcie przycisku „Anuluj" → emit `cancel`
- **Obsługiwana walidacja:** Brak własnej walidacji — wyświetla stan przekazany przez props.
- **Typy:** `GenerationPhase`, `GenerationErrorType`
- **Propsy:**
  ```typescript
  interface Props {
    phase: GenerationPhase;
    hasError: boolean;
    errorType: GenerationErrorType | null;
    elapsedSeconds: number;
  }
  ```
- **Emity:** `cancel`, `retry`

---

### `LoadingPhaseIndicator.vue`

- **Opis:** Wizualna reprezentacja faz generowania. Wyświetla tekst aktualnej fazy (np. „Generuję pytania…", „Weryfikuję jakość…", „Przygotowuję rundy…") oraz animowany pulsujący indykator. Fazy zmieniają się na podstawie upływającego czasu (fazowy, nie liniowy pasek postępu).
- **Główne elementy:**
  - `<p>` z tekstem fazy
  - `<div>` z animacją CSS (pulsowanie kółek / dots)
  - Estymowany czas: `<span>` z formatem „~X sekund"
- **Obsługiwane interakcje:** brak
- **Obsługiwana walidacja:** brak
- **Typy:** `GenerationPhase`
- **Propsy:**
  ```typescript
  interface Props {
    phase: GenerationPhase;
    elapsedSeconds: number;
  }
  ```

---

### `FootballFactCarousel.vue`

- **Opis:** Rotacyjna karuzela wyświetlająca statyczne ciekawostki piłkarskie. Zmienia kartę co 6 sekund. Animacja przejścia `fade` lub `slide`. Ciekawostki zdefiniowane statycznie w komponencie jako stała tablica.
- **Główne elementy:**
  - `<Transition>` — animacja przejścia
  - `<div class="fact-card">` — karta z tekstem ciekawostki
  - `<div class="progress-dots">` — wskaźnik aktualnej karty
- **Obsługiwane interakcje:** Automatyczna rotacja przez `setInterval` (6s). Czyszczenie na `onUnmounted`.
- **Obsługiwana walidacja:** brak
- **Typy:** brak zewnętrznych
- **Propsy:** brak

---

### `GenerationErrorMessage.vue`

- **Opis:** Komponent błędu wyświetlany w przypadku nieudanego generowania. Pokazuje przyjazny komunikat zależny od kodu błędu oraz przycisk ponowienia.
- **Główne elementy:**
  - `<div role="alert">` — komunikat błędu
  - `<p>` — opis błędu dopasowany do `errorType`
  - `<Button>` — „Spróbuj ponownie"
  - `<Button variant="ghost">` — „Wróć do dashboardu"
- **Obsługiwane interakcje:**
  - Kliknięcie „Spróbuj ponownie" → emit `retry`
  - Kliknięcie „Wróć" → emit `cancel`
- **Obsługiwana walidacja:** Komunikaty różnią się dla błędów 422, 429, 502.
- **Typy:** `GenerationErrorType`
- **Propsy:**
  ```typescript
  interface Props {
    errorType: GenerationErrorType;
  }
  ```
- **Emity:** `retry`, `cancel`

---

### `QuizFocusMode.vue`

- **Opis:** Kontener trybu Focus. Renderuje pojedyncze pytanie z timerem i scratchpadem. Zarządza lokalnym stanem timera i odpowiedzi. Rejestruje `focus-trap`. Na `onMounted` pobiera pytania rundy z API.
- **Główne elementy:**
  - `<RoundHeader>` — minimalistyczny nagłówek
  - `<QuestionBlock>` — treść pytania
  - `<TimerWidget>` — odliczanie
  - `<Scratchpad>` — pole scratchpadu
  - `<QuestionProgressIndicator>` — stepper
- **Obsługiwane interakcje:**
  - Timer dochodzi do zera → auto-submit (`timer_expired: true`) → emit `answer-submitted`
  - Zmiana wartości scratchpadu → aktualizacja lokalnego stanu `scratchpadText`
  - Zablokowanie scratchpadu po upływie czasu (`readonly`)
- **Obsługiwana walidacja:**
  - `timer_seconds` z `RoundDTO` musi być w zakresie [15, 30]
  - Pytania muszą być dostępne przed startem timera
- **Typy:** `RoundDTO`, `RoundQuestionDTO`, `CreateAttemptCommand`, `AttemptDTO`, `ActiveQuestionViewModel`
- **Propsy:**
  ```typescript
  interface Props {
    sessionId: string;
    roundPosition: number;
    roundId: string;
    timerSeconds: number;
  }
  ```
- **Emity:** `answer-submitted` (payload: `AttemptDTO`), `round-completed`

---

### `RoundHeader.vue`

- **Opis:** Minimalistyczny pasek informacyjny u góry ekranu gry. Wyświetla numer rundy, numer pytania w rundzie oraz difficulty badge.
- **Główne elementy:**
  - `<span>` — „Runda X/4"
  - `<span>` — „Pytanie Y/10"
  - `<Badge>` z komponentu shadcn-vue — poziom trudności (1-5 gwiazdek lub etykieta)
- **Obsługiwane interakcje:** brak
- **Obsługiwana walidacja:** brak
- **Typy:** brak zewnętrznych
- **Propsy:**
  ```typescript
  interface Props {
    roundPosition: number;
    totalRounds: number;
    questionPosition: number;
    questionsPerRound: number;
    difficultyScore: number;
  }
  ```

---

### `QuestionBlock.vue`

- **Opis:** Blok z treścią pytania. Implementuje fluid typography (dynamiczne skalowanie czcionki przez CSS `clamp()`). Opcjonalnie wyświetla obraz z Supabase Storage. Stosuje anti-cheat: `user-select: none` i `oncontextmenu` na treści pytania.
- **Główne elementy:**
  - `<div @contextmenu.prevent style="user-select:none">` — wrapper pytania z blokadą
  - `<p class="question-text">` — treść pytania ze skalowaniem fluid typography
  - `<img>` lub `<picture>` — opcjonalny obraz z Supabase Storage (leniwe ładowanie)
  - `<Badge>` — badge kategorii
- **Obsługiwane interakcje:** Blokada `contextmenu`. Brak innych interakcji użytkownika.
- **Obsługiwana walidacja:** Jeśli `imagePath` istnieje, budowany jest pełny URL z Supabase Storage.
- **Typy:** `CategoryRefDTO`
- **Propsy:**
  ```typescript
  interface Props {
    questionText: string;
    categories: Pick<CategoryRefDTO, 'name'>[];
    imagePath: string | null;
    supabaseStorageBaseUrl: string;
  }
  ```

---

### `TimerWidget.vue`

- **Opis:** Wizualny licznik czasu w formie paska lub kółka SVG. Progresja kolorów: zielony → żółty → czerwony (CSS `transition`). Pulsowanie w ostatnich 5 sekundach (CSS `animation: pulse`). Poniżej 5 sekund region `aria-live="assertive"` ogłasza pozostały czas co sekundę.
- **Główne elementy:**
  - `<div role="timer" aria-live="assertive" aria-atomic="true">` — komunikaty dla czytników ekranu (poniżej 5s)
  - `<svg>` lub `<div class="timer-bar">` — wizualny wskaźnik
  - `<span>` — cyfrowe odliczanie (np. „15s")
- **Obsługiwane interakcje:** Uruchamia `setInterval` przy montowaniu. Emituje `expired` gdy czas dobiegnie końca. Zatrzymuje interwał po emitowaniu.
- **Obsługiwana walidacja:** `totalSeconds` musi być w zakresie [15, 30].
- **Typy:** brak zewnętrznych
- **Propsy:**
  ```typescript
  interface Props {
    totalSeconds: number;
    autoStart?: boolean; // default: true
  }
  ```
- **Emity:** `tick` (payload: `{ remaining: number }`), `expired`

---

### `Scratchpad.vue`

- **Opis:** Pole textarea na roboczą odpowiedź użytkownika. Automatycznie dostosowuje wysokość na mobilnych urządzeniach za pomocą `visualViewport` API (zapobiega zasłonięciu przez klawiaturę ekranową). Blokuje się (`readonly`) po upływie czasu timera.
- **Główne elementy:**
  - `<label for="scratchpad">` — etykieta dostępnościowa
  - `<textarea id="scratchpad" ref="scratchpadRef">` — pole tekstowe; `aria-label`, `placeholder`
- **Obsługiwane interakcje:**
  - `input` → aktualizacja `modelValue` przez emit `update:modelValue`
  - Nasłuchiwanie `visualViewport resize` — scrollowanie do widoku, gdy klawiatura wirtualna wysuwa się
- **Obsługiwana walidacja:** Gdy `disabled = true`, dodaje `readonly` i `aria-disabled="true"`.
- **Typy:** brak zewnętrznych
- **Propsy:**
  ```typescript
  interface Props {
    modelValue: string;
    disabled: boolean;
  }
  ```
- **Emity:** `update:modelValue`

---

### `QuestionProgressIndicator.vue`

- **Opis:** Kompaktowy stepper lub wskaźnik kropkowy pokazujący postęp w rundzie (1-10). Aktualnie aktywne pytanie wyróżnione stylem.
- **Główne elementy:**
  - `<ol aria-label="Postęp pytań">` — lista kroków
  - `<li>` — każde pytanie; aktywne z klasą `active`, wcześniejsze z klasą `completed`
- **Obsługiwane interakcje:** brak — tylko prezentacja
- **Obsługiwana walidacja:** brak
- **Typy:** brak zewnętrznych
- **Propsy:**
  ```typescript
  interface Props {
    currentPosition: number; // 1-based
    totalQuestions: number;
  }
  ```

---

## 5. Typy

### Typy maszyny stanów (nowe, lokalne)

```typescript
/** Główne stany widoku gry */
type GameState = "loading" | "playing";

/** Fazy generowania AI wyświetlane na ekranie ładowania */
type GenerationPhase =
  | "initiating"    // "Inicjuję połączenie z AI…"
  | "generating"    // "Generuję pytania…"
  | "verifying"     // "Weryfikuję jakość odpowiedzi…"
  | "preparing"     // "Przygotowuję rundy…"
  | "finalizing";   // "Finalizuję sesję…"

/** Typ błędu generowania do dopasowania komunikatu */
type GenerationErrorType = "unprocessable" | "rate_limit" | "upstream" | "unknown";
```

### ViewModel dla aktywnego pytania

```typescript
/** Wewnętrzny model widoku pytania w trybie playing */
interface ActiveQuestionViewModel {
  /** 1-based pozycja pytania w rundzie */
  position: number;
  questionId: string;
  questionText: string;
  difficultyScore: number;
  categories: Pick<CategoryRefDTO, "name">[];
  imagePath: string | null;
  /** Czas (ms) zmierzony od wyświetlenia pytania */
  startedAtMs: number;
}
```

### Typy ze `src/types.ts` używane bezpośrednio

| Typ | Skąd | Zastosowanie |
|-----|------|--------------|
| `CreateGenerationBatchCommand` | types.ts | Body `POST /api/generation-batches` |
| `GenerationBatchCreatedDTO` | types.ts | Response 201 (pending) |
| `GenerationBatchSuccessDTO` | types.ts | Response 202 (success inline) |
| `GenerationBatchDTO` | types.ts | Response pollingu `GET /api/generation-batches/:id` |
| `CreateSessionCommand` | types.ts | Body `POST /api/sessions` |
| `SessionCreatedDTO` | types.ts | Response 201 z `POST /api/sessions` |
| `RoundDTO` | types.ts | Response `GET /api/sessions/:id/rounds/:position` |
| `RoundQuestionDTO` | types.ts | Pojedyncze pytanie w rundzie |
| `CreateAttemptCommand` | types.ts | Body `POST /api/rounds/:roundId/attempts` |
| `AttemptDTO` | types.ts | Response 201 po zapisaniu próby |
| `CategoryRefDTO` | types.ts | Kategorie pytania (badge) |

---

## 6. Zarządzanie stanem

Cały stan gry zarządzany jest lokalnie wewnątrz `GameView.vue` za pomocą `ref` i `computed` z Vue 3 Composition API. Nie używamy Nano Stores (stan dotyczy wyłącznie jednej wyspy i jest efemeryczny — reset przy odświeżeniu).

### Stan w `GameView.vue`

```typescript
const gameState = ref<GameState>("loading");

// --- Dane generowania ---
const generationPhase = ref<GenerationPhase>("initiating");
const batchId = ref<string | null>(null);
const hasError = ref(false);
const errorType = ref<GenerationErrorType | null>(null);
const pollingIntervalId = ref<ReturnType<typeof setInterval> | null>(null);
const generationStartedAt = ref<number>(Date.now());
const elapsedSeconds = computed(() =>
  Math.floor((Date.now() - generationStartedAt.value) / 1000)
);

// --- Dane sesji ---
const sessionId = ref<string | null>(null);
const sessionRounds = ref<RoundSummaryDTO[]>([]);
const timerSeconds = ref<number>(20);

// --- Stan rozgrywki ---
const currentRoundPosition = ref<number>(1);
const currentRoundId = ref<string | null>(null);
const roundData = ref<RoundDTO | null>(null);
const currentQuestionIndex = ref<number>(0);
const activeQuestion = computed<ActiveQuestionViewModel | null>(() => {
  if (!roundData.value) return null;
  const q = roundData.value.questions[currentQuestionIndex.value];
  return q ? { position: q.position, questionId: q.question_id, ...q, startedAtMs: 0 } : null;
});
const scratchpadText = ref<string>("");
const isTimerExpired = ref<boolean>(false);
```

### Przejścia stanów

```
[onMounted] → POST /api/generation-batches
    ↓ (201 pending)
generationPhase: "initiating" → "generating"
    ↓ polling GET /api/generation-batches/:id co 3s
    ↓ (status: "success") → POST /api/sessions
    ↓ (201) → GET /api/sessions/:id/rounds/1
    ↓ (200 RoundDTO)
gameState: "loading" → "playing"
    ↓ timer expired / answer submitted → POST /api/rounds/:roundId/attempts
    ↓ nextQuestion() lub (ostatnie pytanie w rundzie) → emit round-completed
```

### Composable `useGameTimer`

Wyodrębniony composable `src/composables/useGameTimer.ts` obsługuje logikę timera (start/stop/reset) i separuje ją od komponentu wizualnego.

```typescript
// src/composables/useGameTimer.ts
export function useGameTimer(totalSeconds: number) {
  const remaining = ref(totalSeconds);
  const isExpired = ref(false);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function start() { /* ... */ }
  function stop() { /* ... */ }
  function reset() { /* ... */ }

  onUnmounted(() => stop());
  return { remaining, isExpired, start, stop, reset };
}
```

---

## 7. Integracja API

### `POST /api/generation-batches`

- **Kiedy:** `onMounted` w `GameView.vue`
- **Request body** (`CreateGenerationBatchCommand`):
  ```json
  {
    "model": "gpt-4o",
    "provider": "openrouter",
    "prompt_version": "v1",
    "requested_questions_count": 40
  }
  ```
- **Response 201** (`GenerationBatchCreatedDTO`): batch w statusie `pending` → uruchom polling
- **Response 202** (`GenerationBatchSuccessDTO`): sukces inline → przejdź bezpośrednio do `POST /api/sessions`
- **Błędy:** 400, 422 → `errorType = "unprocessable"`, 429 → `errorType = "rate_limit"`, 502 → `errorType = "upstream"`

### `GET /api/generation-batches/:id`

- **Kiedy:** Co 3 sekundy po otrzymaniu 201, przez `setInterval`
- **Response** (`GenerationBatchDTO`):
  - `status === "success"` → zatrzymaj polling, uruchom `POST /api/sessions`
  - `status === "failed"` → zatrzymaj polling, `hasError = true`
  - `status === "pending"` → aktualizuj `generationPhase` na podstawie upływu czasu
- **Bezpieczeństwo:** Max timeout 50 sekund (>40s z buforem) — jeśli przekroczony, `errorType = "upstream"`

### `POST /api/sessions`

- **Kiedy:** Po `status === "success"` z batcha
- **Request body** (`CreateSessionCommand`):
  ```json
  {
    "generation_batch_id": "<batchId>",
    "timer_seconds": 20
  }
  ```
- **Response 201** (`SessionCreatedDTO`): zapisz `sessionId`, `rounds`, `timerSeconds`
- **Błędy:** 404 → batch nie istnieje, 422 → batch nie jest `success`

### `GET /api/sessions/:sessionId/rounds/:position`

- **Kiedy:** Po utworzeniu sesji (raz) i po ukończeniu każdej rundy (przejście do kolejnej)
- **Response 200** (`RoundDTO`): zapisz dane pytań, `timer_seconds`, `id` rundy
- **Ważne:** `correct_answer` jest `null` podczas `status = "in_progress"` — nie wyświetlać

### `POST /api/rounds/:roundId/attempts`

- **Kiedy:** Po każdym pytaniu — albo gdy timer wygaśnie (`timer_expired: true`), albo gdy użytkownik "zatwierdzi" (automatycznie po wygaśnięciu)
- **Request body** (`CreateAttemptCommand`):
  ```json
  {
    "question_id": "<questionId>",
    "position": 3,
    "scratchpad": "Messi 2012",
    "time_taken_ms": 14320,
    "timer_expired": false
  }
  ```
- **Response 201** (`AttemptDTO`): po zapisaniu próby przejdź do kolejnego pytania

---

## 8. Interakcje użytkownika

| Interakcja | Komponent | Zachowanie |
|-----------|-----------|------------|
| Kliknięcie „Anuluj" podczas ładowania | `GenerationLoadingScreen` | Emit `cancel` → `GameView` przekierowuje do `/dashboard` |
| Kliknięcie „Spróbuj ponownie" po błędzie | `GenerationErrorMessage` | Emit `retry` → `GameView` restartuje generowanie |
| Wpisywanie tekstu w scratchpadzie | `Scratchpad` | Aktualizacja `scratchpadText` w stanie `QuizFocusMode` |
| Upływ czasu timera | `TimerWidget` → emit `expired` | `QuizFocusMode` blokuje scratchpad, auto-submituje `CreateAttemptCommand` z `timer_expired: true`, przechodzi do następnego pytania |
| Próba zamknięcia/odświeżenia karty | `window.beforeunload` (w `GameView`) | Dialog potwierdzenia przeglądarki „Czy na pewno chcesz opuścić stronę?" |
| Próba zaznaczenia tekstu pytania | `QuestionBlock` | Zablokowane przez `user-select: none` |
| Prawy przycisk myszy na pytaniu | `QuestionBlock` | Zablokowane przez `@contextmenu.prevent` |
| Scroll w górę strony (klawiatura) | `Scratchpad` → `visualViewport` | Automatyczne przescrollowanie do scratchpadu, gdy klawiatura ekranowa wychodzi |

---

## 9. Warunki i walidacja

### Warunki generowania (stan `loading`)

| Warunek | Komponent | Efekt |
|---------|-----------|-------|
| `status === "pending"` po POST | `GameView` | Uruchamia polling, wyświetla `LoadingPhaseIndicator` |
| `status === "success"` po GET | `GameView` | Zatrzymuje polling, przechodzi do tworzenia sesji |
| `status === "failed"` po GET | `GameView` | `hasError = true`, `errorType = "unknown"` |
| HTTP 422 z POST/GET | `GameView` | `errorType = "unprocessable"` → komunikat o błędzie formatu AI |
| HTTP 429 z POST | `GameView` | `errorType = "rate_limit"` → komunikat o limicie |
| HTTP 502 z POST | `GameView` | `errorType = "upstream"` → komunikat o problemie z AI |
| Timeout 50s | `GameView` | Zatrzymuje polling, `errorType = "upstream"` |

### Warunki sesji i rundy (stan `playing`)

| Warunek | Komponent | Efekt |
|---------|-----------|-------|
| `timer_seconds` poza [15, 30] | `QuizFocusMode` | Fallback do 20s |
| `roundData` nie załadowane | `QuizFocusMode` | Wyświetlenie szkieletu ładowania (spinner), brak startu timera |
| `isTimerExpired === true` | `Scratchpad` | `disabled = true`, `readonly`, `aria-disabled="true"` |
| Wszystkie 10 pytań w rundzie zakończone | `GameView` | Emit `round-completed`, przekierowanie do widoku podsumowania rundy |

---

## 10. Obsługa błędów

### Błędy generowania

- **HTTP 422** — AI zwróciło nieprawidłowy JSON po max. retries. Komunikat: „Wystąpił problem z generowaniem pytań przez AI. Spróbuj ponownie." + przycisk retry.
- **HTTP 429** — przekroczony limit zapytań. Komunikat: „Przekroczono limit generowania. Spróbuj ponownie za chwilę." + przycisk retry z opóźnieniem (15s cooldown na przycisku).
- **HTTP 502** — błąd po stronie OpenRouter. Komunikat: „Usługa AI jest chwilowo niedostępna. Spróbuj ponownie." + przycisk retry.
- **Timeout 50s** — polling nie zakończył się sukcesem. Traktowany jak 502.
- **Retry mechanic:** Każde naciśnięcie „Spróbuj ponownie" resetuje stan (`hasError = false`, `batchId = null`) i wywołuje `POST /api/generation-batches` od nowa.

### Błędy sesji / rundy

- **HTTP 404 / 422 z `POST /api/sessions`** — przekierowanie do dashboardu z komunikatem toast „Nie można uruchomić sesji. Spróbuj wygenerować nowy quiz."
- **Błąd sieci przy `GET rounds/:position`** — wyświetlenie komunikatu inline z przyciskiem „Załaduj ponownie" (retry bez tworzenia nowej sesji).
- **Błąd sieci przy `POST attempts`** — ponowna próba do 3 razy z exponential backoff (500ms, 1s, 2s). Jeśli niepowodzenie — zapisanie w `sessionStorage` i ponowna próba przy następnej nawigacji.

### Guard przed opuszczeniem strony (US-007)

- `beforeunload` jest rejestrowany w `onMounted` wyspy `GameView` i usuwany w `onUnmounted`.
- W trakcie rundy (`gameState === "playing"`) guard jest aktywny.
- Po odświeżeniu strony: Astro wyrenderuje stronę `/game` od nowa bez stanu Vue — wyspy wrócą do stanu `loading`, co z perspektywy użytkownika oznacza utratę postępu i konieczność ponownego wygenerowania quizu (zgodnie z US-007).
- Stan scratchpadu **NIE jest** zapisywany w LocalStorage (zgodnie z US-007 kryterium 1).

---

## 11. Kroki implementacji

1. **Utwórz plik strony Astro** `src/pages/game.astro`:
   - Użyj layoutu bez topbara (lub z warunkowym ukryciem nawigacji)
   - Sprawdź `Astro.locals.user` i przekieruj do `/auth/signin` jeśli brak
   - Zamontuj wyspę `<GameView client:only="vue" />` bez żadnych props (nie przekazujemy danych serwera do wyspy, bo stan gry jest w pełni po stronie klienta)

2. **Zdefiniuj composable `useGameTimer`** w `src/composables/useGameTimer.ts`:
   - `ref<number>` dla `remaining`
   - `setInterval` z czyszczeniem w `onUnmounted`
   - Emitowanie przez callback `onExpired` przekazany jako argument

3. **Zbuduj `GameView.vue`** (`src/components/game/GameView.vue`):
   - Zadeklaruj `gameState`, dane generowania, dane sesji
   - Implementuj `startGeneration()`, `pollBatchStatus()`, `createSession()`, `loadRound()`
   - Zarejestruj i usuń `beforeunload` guard
   - Warunkowo renderuj `GenerationLoadingScreen` lub `QuizFocusMode`

4. **Zbuduj komponenty ekranu ładowania** (`src/components/game/`):
   - `GenerationLoadingScreen.vue` — szkielet z slotami na sub-komponenty
   - `LoadingPhaseIndicator.vue` — logika faz na podstawie `elapsedSeconds`
   - `FootballFactCarousel.vue` — statyczna tablica ciekawostek + `setInterval`
   - `GenerationErrorMessage.vue` — mapowanie `errorType` na komunikaty

5. **Zbuduj komponenty trybu Playing**:
   - `QuizFocusMode.vue` — pobiera dane rundy, zarządza stanem pytań i scratchpadu
   - `RoundHeader.vue` — czysto prezentacyjny
   - `QuestionBlock.vue` — anti-cheat `user-select: none`, `@contextmenu.prevent`
   - `TimerWidget.vue` — SVG lub CSS bar, progresja kolorów, pulsowanie
   - `Scratchpad.vue` — `visualViewport` listener, `readonly` gdy `disabled`
   - `QuestionProgressIndicator.vue` — czysto prezentacyjny

6. **Dodaj globalne style trybu Focus** w `src/styles/global.css`:
   - Klasa `.focus-mode` na `<body>` ukrywająca nawigację (lub manipulacja przez Vue inject/provide)
   - Ewentualnie: dedykowany layout Astro dla `/game` bez Topbar

7. **Podłącz logikę API w `QuizFocusMode.vue`**:
   - `GET /api/sessions/:sessionId/rounds/:position` przy wejściu do rundy
   - `POST /api/rounds/:roundId/attempts` po każdym pytaniu (automatycznie po wygaśnięciu timera lub ręcznie)

8. **Zaimplementuj obsługę błędów sieci** (retry logika dla `POST /api/rounds/:roundId/attempts`)

9. **Przetestuj scenariusze brzegowe**:
   - Odświeżenie strony podczas ładowania / w trakcie pytania
   - Timeout 50s podczas generowania
   - Odpowiedź 429 z cooldownem przycisku
   - Blokowanie scratchpadu po wygaśnięciu timera
   - Dostępność (NVDA/JAWS) — weryfikacja `aria-live` regionów

10. **Zweryfikuj lint i typy** (`npm run lint`, `npm run build`) i popraw ewentualne błędy TypeScript
