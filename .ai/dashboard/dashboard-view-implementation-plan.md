# Plan implementacji widoku Dashboard

## 1. Przegląd

Widok Dashboard (`/dashboard`) pełni rolę centrum dowodzenia aplikacji VARtownik. Prezentuje użytkownikowi podsumowanie jego postępów treningowych: ogólną skuteczność, liczbę ukończonych sesji, oflagowane pytania oczekujące na przegląd, wykres radarowy skuteczności per kategoria oraz tabelę ostatnich 10 sesji. Dane podstawowe są ładowane server-side (SSR Astro) dla błyskawicznego FCP — brak flickeringu. Interaktywne elementy (wykres radarowy z filtrowaniem dat, tabela sesji z paginacją) są zrealizowane jako Vue 3 islands (`client:load`). Dostęp chroniony jest przez middleware Astro.

---

## 2. Routing widoku

| Widok     | Ścieżka      | Plik Astro                        |
| --------- | ------------ | --------------------------------- |
| Dashboard | `/dashboard` | `src/pages/dashboard.astro` (istniejący) |

Middleware (`src/middleware.ts`) zapewnia ochronę trasy — niezalogowani użytkownicy są przekierowywani na `/auth/signin`. Widok renderowany jest wyłącznie server-side.

---

## 3. Struktura komponentów

```
dashboard.astro (SSR — pobiera dane z 3 endpointów)
├── Layout.astro
├── Topbar.astro
├── QuickStartWidget.astro
├── StatsOverviewWidget.astro
│   ├── StatCard.astro (×3: skuteczność, sesje, oflagowane)
├── PendingReviewsWidget.astro
│   └── lista PendingQuestionDTO (max 5)
├── CategoryRadarChart.vue [client:load]
│   └── <canvas> Chart.js (radar)
└── RecentSessionsTable.vue [client:load]
    └── shadcn-vue Table + Pagination
```

Astro przekazuje dane pobrane SSR jako propsy do każdego komponentu (statycznego i Vue islands).

---

## 4. Szczegóły komponentów

### `dashboard.astro`

- **Opis:** Główna strona dashboardu. Wykonuje równoległe wywołania SSR do trzech endpointów (`/api/stats/overview`, `/api/stats/categories`, `/api/sessions?page=1&limit=10`). Obsługuje błędy na poziomie strony (każdy wynik może być `null`). Montuje responsywny grid (2 kolumny desktop / 1 kolumna mobile) i osadza wszystkie podkomponenty.
- **Główne elementy HTML:** `<Layout>`, `<Topbar>`, `<main>` z siatką CSS Grid (Tailwind), sekcja nagłówkowa z powitaniem (`user.email`), ikona kłódki z tooltipem „Tylko Twoje dane" (`LockKeyholeIcon` z lucide).
- **Obsługiwane interakcje:** brak bezpośrednich — delegowane do podkomponentów i Vue islands.
- **Warunki walidacji:** Sprawdza obecność `Astro.locals.user` (gwarantuje middleware). Każde wywołanie API owinięte w `try/catch` — przy błędzie przekazuje `null` do odpowiedniego widżetu.
- **Typy:** `StatsOverviewDTO | null`, `CategoryStatsResponseDTO | null`, `SessionsResponseDTO | null`
- **Propsy:** brak (strona korzeniowa).

---

### `QuickStartWidget.astro`

- **Opis:** Widżet szybkiego startu — karta zachęcająca do uruchomienia nowej sesji treningowej. Kliknięcie przycisku przekierowuje do strony inicjowania quizu.
- **Główne elementy HTML:** Karta (`<div>`), ikona `ZapIcon` (lucide), nagłówek „Gotowy na trening?", krótki opis, przycisk `<Button>` (shadcn-vue Button, wariant `default`) z etykietą „Generuj Quiz", link oparty na `<a href="/quiz/new">`.
- **Obsługiwane interakcje:** Kliknięcie przycisku → nawigacja do `/quiz/new`.
- **Warunki walidacji:** brak (statyczny).
- **Typy:** brak dodatkowych.
- **Propsy:** brak.

---

### `StatsOverviewWidget.astro`

- **Opis:** Widżet statystyk ogólnych. Wyświetla trzy karty `StatCard` z kluczowymi wskaźnikami pobranymi SSR. Przy `overview === null` wyświetla komunikat błędu.
- **Główne elementy HTML:** Nagłówek sekcji, grid 3 kart (Tailwind `grid-cols-3 md:grid-cols-1`), trzy instancje `<StatCard>`, opcjonalny `<ErrorAlert>`.
- **Obsługiwane interakcje:** brak (statyczny).
- **Warunki walidacji:**
  - Gdy `overview === null` → wyświetlenie `<ErrorAlert message="Nie udało się załadować statystyk" />`.
  - `overall_accuracy_percent` formatowany do 1 miejsca po przecinku z sufiksem `%`.
- **Typy:** `StatsOverviewDTO | null`
- **Propsy:** `overview: StatsOverviewDTO | null`

---

### `StatCard.astro`

- **Opis:** Karta prezentująca pojedynczy wskaźnik: ikona + wartość + etykieta. Wielokrotnego użytku.
- **Główne elementy HTML:** `<div>` (rounded card, border, backdrop-blur), ikona lucide, `<span>` z wartością (duży rozmiar), `<p>` z etykietą (muted), opcjonalny `accent` (kolor wartości).
- **Obsługiwane interakcje:** brak.
- **Warunki walidacji:** brak.
- **Typy:** brak dodatkowych.
- **Propsy:**
  ```typescript
  interface StatCardProps {
    icon: string;        // nazwa ikony lucide, np. "TrendingUp"
    value: string;       // sformatowana wartość, np. "69.9%"
    label: string;       // etykieta, np. "Ogólna skuteczność"
    accent?: string;     // opcjonalny kolor Tailwind, np. "text-green-400"
  }
  ```

---

### `PendingReviewsWidget.astro`

- **Opis:** Widżet listy oflagowanych pytań oczekujących na przegląd przez użytkownika. Wyświetla maksymalnie 5 pytań z linkiem do edycji każdego. Link „Zobacz wszystkie" prowadzi do przefiltrowanego widoku CRUD.
- **Główne elementy HTML:** Nagłówek z liczbą oczekujących (Badge), lista `<ul>` z max 5 elementami `<li>` (tekst pytania obcięty do 80 znaków + link „Edytuj"), link „Zobacz wszystkie →" do `/questions?status=flagged`.
- **Obsługiwane interakcje:** Kliknięcie „Edytuj" → nawigacja do `/questions/:id/edit`. Kliknięcie „Zobacz wszystkie" → nawigacja do `/questions?status=flagged`.
- **Warunki walidacji:**
  - Gdy `flaggedQuestions.length === 0` → komunikat „Brak pytań do przejrzenia ✓" (stan pozytywny).
  - Gdy `overview === null` → komunikat błędu.
- **Typy:** `PendingQuestionDTO[]`, `number`
- **Propsy:**
  ```typescript
  interface PendingReviewsWidgetProps {
    flaggedQuestions: PendingQuestionDTO[];
    totalFlagged: number;
  }
  ```

---

### `CategoryRadarChart.vue`

- **Opis:** Vue 3 island wyświetlający interaktywny wykres radarowy skuteczności per kategoria tematyczna. Umożliwia filtrowanie danych według zakresu dat (od/do). Używa `chart.js` + `vue-chartjs`.
- **Główne elementy HTML/Vue:** Dwa inputy daty (`<Input type="date">` shadcn-vue), komunikat walidacji dat, `<Radar>` (komponent `vue-chartjs`), spinner podczas ładowania, `<ErrorAlert>` przy błędzie.
- **Obsługiwane interakcje:**
  - Zmiana pola `fromDate` lub `toDate` → debounce 500 ms → `fetchCategoryStats()` → aktualizacja wykresu.
  - Najechanie na punkt wykresu → natywny tooltip Chart.js.
- **Warunki walidacji:**
  - `fromDate > toDate` → inline error „Data od nie może być późniejsza niż data do"; blokada wywołania API.
  - `fromDate` lub `toDate` w przyszłości → inline error „Data nie może być w przyszłości".
  - `chartData.length === 0` po fetch → komunikat „Brak danych kategorii dla wybranego okresu".
- **Typy:** `CategoryStatsItemDTO[]`, `CategoryStatsResponseDTO`
- **Propsy:**
  ```typescript
  interface CategoryRadarChartProps {
    initialData: CategoryStatsItemDTO[];
  }
  ```
- **Stan lokalny:** `chartData`, `fromDate`, `toDate`, `isLoading`, `error`

---

### `RecentSessionsTable.vue`

- **Opis:** Vue 3 island z tabelą ostatnich sesji treningowych. Obsługuje paginację po stronie klienta (fetch kolejnych stron z API).
- **Główne elementy HTML/Vue:** Tabela shadcn-vue (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`). Kolumny: Data, Wynik (%), Rundy, Status (Badge), Akcja (link szczegółów). Kontrolki paginacji: przyciski Poprzednia/Następna, info „Strona X z Y".
- **Obsługiwane interakcje:**
  - Kliknięcie „Następna" / „Poprzednia" → `fetchSessions(newPage)` → aktualizacja tabeli.
  - Kliknięcie linku „Szczegóły" w wierszu → nawigacja do `/sessions/:id`.
- **Warunki walidacji:**
  - `sessions.length === 0` → komunikat „Brak sesji treningowych. Wygeneruj pierwszy quiz!".
  - Sesja ze statusem `in_progress` → Badge „W trakcie" zamiast wartości score (score_summary może być `null`).
  - Sesja ze statusem `abandoned` → Badge „Przerwana", score wyświetlany jeśli dostępny.
  - Przycisk „Poprzednia" disabled gdy `currentPage === 1`.
  - Przycisk „Następna" disabled gdy `currentPage * limit >= pagination.total`.
- **Typy:** `SessionListItemDTO[]`, `PaginationDTO`
- **Propsy:**
  ```typescript
  interface RecentSessionsTableProps {
    initialSessions: SessionListItemDTO[];
    initialPagination: PaginationDTO;
  }
  ```
- **Stan lokalny:** `sessions`, `pagination`, `currentPage`, `isLoading`, `error`

---

## 5. Typy

Poniższe typy należy dodać do `src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Dashboard — Stats
// ---------------------------------------------------------------------------

/** GET /api/stats/overview response */
export interface StatsOverviewDTO {
  total_attempts: number;
  knew_count: number;
  did_not_know_count: number;
  overall_accuracy_percent: number;
  total_sessions_completed: number;
  flagged_questions_pending: number;
}

/** Pojedynczy element GET /api/stats/categories */
export interface CategoryStatsItemDTO {
  category_id: string;
  category_name: string;
  attempts_count: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number;
}

/** GET /api/stats/categories response */
export interface CategoryStatsResponseDTO {
  data: CategoryStatsItemDTO[];
}

// ---------------------------------------------------------------------------
// Dashboard — Sessions
// ---------------------------------------------------------------------------

/** Podsumowanie wynikowe sesji (pole zagnieżdżone w SessionListItemDTO) */
export interface SessionScoreSummaryDTO {
  total_questions: number;
  knew_count: number;
  did_not_know_count: number;
  accuracy_percent: number;
}

/** Pojedynczy element listy sesji GET /api/sessions */
export interface SessionListItemDTO {
  id: string;
  status: SessionStatus; // re-export z enums: "in_progress" | "completed" | "abandoned"
  timer_seconds: number;
  total_rounds: number;
  questions_per_round: number;
  started_at: string;
  completed_at: string | null;
  score_summary: SessionScoreSummaryDTO | null;
}

/** GET /api/sessions response */
export interface SessionsResponseDTO {
  data: SessionListItemDTO[];
  pagination: PaginationDTO; // istniejący typ
}

// ---------------------------------------------------------------------------
// Dashboard — Pending Reviews
// ---------------------------------------------------------------------------

/** Slim DTO oflagowanego pytania dla widżetu PendingReviews */
export interface PendingQuestionDTO {
  id: string;
  question_text: string;
  created_at: string;
}
```

---

## 6. Zarządzanie stanem

**Dane SSR (Astro):**
- `dashboard.astro` pobiera równolegle dane z trzech endpointów (`Promise.allSettled`) i przekazuje je jako propsy do komponentów. Każde wywołanie owinięte w `try/catch` — błąd zwraca `null`.

**Stan Vue islands (lokalny, bez Nano Store):**

| Island | Stan lokalny | Opis |
|---|---|---|
| `CategoryRadarChart.vue` | `chartData: CategoryStatsItemDTO[]` | Aktualne dane wykresu |
| | `fromDate: string` | Data "od" filtru (default: 30 dni wstecz) |
| | `toDate: string` | Data "do" filtru (default: dzisiaj) |
| | `isLoading: boolean` | Spinner podczas fetch |
| | `error: string \| null` | Komunikat błędu inline |
| `RecentSessionsTable.vue` | `sessions: SessionListItemDTO[]` | Aktualna strona sesji |
| | `pagination: PaginationDTO` | Metadane paginacji |
| | `currentPage: number` | Aktualna strona (1-indexed) |
| | `isLoading: boolean` | Spinner podczas zmiany strony |
| | `error: string \| null` | Komunikat błędu inline |

Globalny Nano Store nie jest wymagany dla tego widoku — stan jest izolowany w poszczególnych wyspach.

---

## 7. Integracja API

### `GET /api/stats/overview`
- **Wywołanie:** SSR w `dashboard.astro` (`createSupabaseServerClient`)
- **Żądanie:** brak parametrów
- **Odpowiedź:** `StatsOverviewDTO`
- **Obsługa błędu:** `catch → overview = null`

### `GET /api/stats/categories`
- **Wywołanie SSR:** `dashboard.astro` z domyślnymi datami (`from = -30 dni`, `to = dziś`)
- **Wywołanie client-side:** `CategoryRadarChart.vue` przy zmianie zakresu dat
- **Żądanie:** `?from=YYYY-MM-DD&to=YYYY-MM-DD`
- **Odpowiedź:** `CategoryStatsResponseDTO`
- **Obsługa błędu SSR:** `catch → categoryData = null` | **client-side:** `error.value = "..."` + poprzednie dane pozostają widoczne

### `GET /api/sessions`
- **Wywołanie SSR:** `dashboard.astro` z `?page=1&limit=10`
- **Wywołanie client-side:** `RecentSessionsTable.vue` przy paginacji z `?page=N&limit=10`
- **Żądanie:** `?page: number&limit: number`
- **Odpowiedź:** `SessionsResponseDTO`
- **Obsługa błędu SSR:** `catch → sessionsData = null` | **client-side:** `error.value = "..."` + bieżące dane pozostają

---

## 8. Interakcje użytkownika

| Interakcja | Komponent | Oczekiwany efekt |
|---|---|---|
| Kliknięcie „Generuj Quiz" | `QuickStartWidget` | Nawigacja do `/quiz/new` |
| Kliknięcie „Edytuj" przy pytaniu | `PendingReviewsWidget` | Nawigacja do `/questions/:id/edit` |
| Kliknięcie „Zobacz wszystkie" | `PendingReviewsWidget` | Nawigacja do `/questions?status=flagged` |
| Zmiana `fromDate` lub `toDate` | `CategoryRadarChart` | Debounce 500 ms → fetch → aktualizacja wykresu radarowego |
| Hover na punkt wykresu | `CategoryRadarChart` | Tooltip Chart.js z nazwą kategorii i dokładnością |
| Kliknięcie „Następna strona" | `RecentSessionsTable` | Fetch kolejnej strony sesji, aktualizacja tabeli |
| Kliknięcie „Poprzednia strona" | `RecentSessionsTable` | Fetch poprzedniej strony sesji, aktualizacja tabeli |
| Kliknięcie „Szczegóły" w wierszu | `RecentSessionsTable` | Nawigacja do `/sessions/:id` |

---

## 9. Warunki i walidacja

| Warunek | Komponent | Stan UI |
|---|---|---|
| `overview === null` | `StatsOverviewWidget` | Alert z komunikatem błędu ładowania |
| `overview.overall_accuracy_percent` | `StatCard` | Formatowanie do 1 miejsca: `"69.9%"` |
| `flaggedQuestions.length === 0` | `PendingReviewsWidget` | Komunikat sukcesu „Brak pytań do przejrzenia ✓" |
| `fromDate > toDate` | `CategoryRadarChart` | Inline error, blokada fetch |
| `fromDate` lub `toDate` w przyszłości | `CategoryRadarChart` | Inline error, blokada fetch |
| `chartData.length === 0` | `CategoryRadarChart` | Komunikat „Brak danych dla wybranego okresu" |
| `sessions.length === 0` | `RecentSessionsTable` | Komunikat zachęcający do pierwszego quizu |
| `session.status === 'in_progress'` | `RecentSessionsTable` | Badge „W trakcie"; score wyświetlany jeśli dostępny |
| `session.status === 'abandoned'` | `RecentSessionsTable` | Badge „Przerwana" (muted) |
| `currentPage === 1` | `RecentSessionsTable` | Przycisk „Poprzednia" disabled |
| `currentPage * 10 >= pagination.total` | `RecentSessionsTable` | Przycisk „Następna" disabled |

---

## 10. Obsługa błędów

**Błędy SSR (`dashboard.astro`):**
- Każde wywołanie API owinięte w `try/catch`. Przy błędzie dana zmienna ustawiana na `null`.
- Każdy widżet sprawdza swój prop na `null` i renderuje `<ErrorAlert>` z komunikatem „Nie udało się załadować danych. Odśwież stronę." i przyciskiem odświeżenia.
- Błędy są logowane server-side (`console.error`) z kontekstem endpointu.

**Błędy client-side (Vue islands):**
- Błąd `fetch` w `CategoryRadarChart` ustawia `error.value`; poprzednie dane wykresu pozostają widoczne do czasu pomyślnego powtórzenia.
- Błąd `fetch` w `RecentSessionsTable` ustawia `error.value`; poprzednia tabela pozostaje widoczna.
- Status HTTP `401` w odpowiedzi client-side → `window.location.href = '/auth/signin'`.
- Komunikaty błędów są przyjazne użytkownikowi (bez surowych stack trace'ów).

**Przypadki brzegowe:**
- Brak sesji (nowy użytkownik) → `RecentSessionsTable` wyświetla stan pusty z zachętą do wygenerowania quizu.
- Brak kategorii z danymi → `CategoryRadarChart` wyświetla komunikat zamiast pustego płótna.
- Ładowanie SSR trwa długo → Astro streamuje odpowiedź; Vue islands mają `isLoading = false` (dane już są w propsach).

---

## 11. Kroki implementacji

1. **Typy** — dodać `StatsOverviewDTO`, `CategoryStatsItemDTO`, `CategoryStatsResponseDTO`, `SessionScoreSummaryDTO`, `SessionListItemDTO`, `SessionsResponseDTO`, `PendingQuestionDTO` do `src/types.ts`.

2. **API endpoint** — stworzyć `src/pages/api/stats/overview.ts` (GET, zwraca `StatsOverviewDTO` dla zalogowanego użytkownika z Supabase).

3. **API endpoint** — stworzyć `src/pages/api/stats/categories.ts` (GET, query params `from` i `to`, zwraca `CategoryStatsResponseDTO`).

4. **API endpoint** — stworzyć `src/pages/api/sessions/index.ts` (GET, query params `page`, `limit`, `status`; zwraca `SessionsResponseDTO`).

5. **Komponent** — stworzyć `src/components/dashboard/StatCard.astro` z propsami `icon`, `value`, `label`, `accent`.

6. **Komponent** — stworzyć `src/components/dashboard/StatsOverviewWidget.astro` przyjmujący `overview: StatsOverviewDTO | null`.

7. **Komponent** — stworzyć `src/components/dashboard/QuickStartWidget.astro` z przyciskiem nawigującym do `/quiz/new`.

8. **Komponent** — stworzyć `src/components/dashboard/PendingReviewsWidget.astro` z listą pytań i linkami.

9. **Biblioteka wykresów** — zainstalować `chart.js` oraz `vue-chartjs` (`npm install chart.js vue-chartjs`).

10. **Komponent** — stworzyć `src/components/dashboard/CategoryRadarChart.vue` jako Vue island z filtrowaniem dat, obsługą błędów i wykresem radarowym.

11. **Komponent** — stworzyć `src/components/dashboard/RecentSessionsTable.vue` jako Vue island z tabelą, paginacją i obsługą błędów.

12. **Strona** — zaktualizować `src/pages/dashboard.astro`: równoległy fetch SSR (`Promise.allSettled`), responsywny grid (2 kolumny desktop / 1 mobile), osadzić wszystkie komponenty z propsami, dodać indykator prywatności (ikona kłódki + tooltip).

13. **Lint** — uruchomić `npm run lint` i naprawić ewentualne błędy przed ukończeniem.
