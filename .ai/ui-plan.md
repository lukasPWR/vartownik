# Architektura UI dla VARtownik

## 1. Przegląd struktury UI

Aplikacja VARtownik realizuje hybrydowy model renderowania: **Astro 5 SSR** obsługuje statyczne strony, layout, autoryzację oraz routing, natomiast **Vue 3 (Composition API)** w formie interaktywnych wysp (islands) zarządza logiką reaktywną — przede wszystkim silnikiem gry (Quiz Engine), panelem CRUD pytań i widżetami dashboardu.

Interfejs dzieli się na dwa tryby wizualne:

- **Tryb Standard** — jasny, analityczny interfejs (dashboard, CRUD, ustawienia). Widoczna pełna nawigacja.
- **Tryb Focus** — ciemny, minimalistyczny interfejs aktywny wyłącznie podczas trwającej rundy quizu. Nawigacja i elementy rozpraszające są ukryte, aby symulować warunki turniejowe.

Stan gry przechowywany jest wyłącznie w pamięci operacyjnej (Nano Stores / Pinia), bez zapisu w `localStorage` ani w bazie danych — odświeżenie strony celowo unieważnia trwającą rundę (US-007). Każda odpowiedź jest natychmiastowo wysyłana do API (`POST /api/rounds/:roundId/attempts`), co minimalizuje ryzyko utraty danych.

Architektura jest mobile-first z uwzględnieniem ergonomii kciuka w trybie quizu. Bezpieczeństwo danych oparte na RLS Supabase jest komunikowane użytkownikowi poprzez subtelne indykatory prywatności w UI.

---

## 2. Lista widoków

### 2.1. Ekran logowania

- **Ścieżka:** `/auth/signin`
- **Główny cel:** Uwierzytelnienie istniejącego użytkownika za pomocą e-mail i hasła.
- **Kluczowe informacje:** Formularz logowania, link do rejestracji, komunikaty błędów walidacji.
- **Kluczowe komponenty:**
  - Formularz logowania (e-mail + hasło)
  - Przycisk „Zaloguj się"
  - Link do `/auth/signup`
  - Alert z komunikatem błędu (nieprawidłowe dane, konto nieaktywne)
- **UX / Dostępność / Bezpieczeństwo:**
  - Autofocus na polu e-mail
  - Walidacja inline (format e-mail, minimalna długość hasła)
  - Sesja zarządzana przez HttpOnly cookie (Supabase SSR) — brak tokenów w `localStorage`
  - Ochrona przed brute-force po stronie Supabase Auth
  - Dane wrażliwe przesyłane wyłącznie przez HTTPS
- **Mapowanie API:** `POST /api/auth/signin`
- **Mapowanie US:** US-001

---

### 2.2. Ekran rejestracji

- **Ścieżka:** `/auth/signup`
- **Główny cel:** Utworzenie nowego konta użytkownika.
- **Kluczowe informacje:** Formularz rejestracji, informacja o wymaganiach dotyczących hasła.
- **Kluczowe komponenty:**
  - Formularz rejestracji (e-mail + hasło + potwierdzenie hasła)
  - Przycisk „Zarejestruj się"
  - Link do `/auth/signin`
  - Inline walidacja (siła hasła, zgodność potwierdzenia)
- **UX / Dostępność / Bezpieczeństwo:**
  - Wskaźnik siły hasła
  - Jasne komunikaty walidacyjne przy każdym polu
  - Po pomyślnej rejestracji przekierowanie na `/auth/confirm-email`
- **Mapowanie API:** `POST /api/auth/signup`
- **Mapowanie US:** US-001

---

### 2.3. Potwierdzenie e-mail

- **Ścieżka:** `/auth/confirm-email`
- **Główny cel:** Informacja o konieczności potwierdzenia adresu e-mail.
- **Kluczowe informacje:** Komunikat potwierdzający wysłanie e-maila, instrukcja dalszego działania.
- **Kluczowe komponenty:**
  - Komunikat informacyjny z ikoną e-mail
  - Link do ponownego wysłania e-maila (opcjonalnie)
  - Link powrotny do `/auth/signin`
- **UX / Dostępność / Bezpieczeństwo:**
  - Jasna informacja, że konto wymaga weryfikacji
  - Brak ujawniania, czy dany e-mail istnieje w systemie (ochrona przed enumeracją)
- **Mapowanie US:** US-001

---

### 2.4. Dashboard

- **Ścieżka:** `/dashboard`
- **Główny cel:** Centrum dowodzenia — przegląd statystyk, szybki start quizu, lista oczekujących recenzji.
- **Kluczowe informacje:**
  - Ogólna skuteczność (% poprawnych odpowiedzi)
  - Liczba ukończonych sesji
  - Liczba oflagowanych pytań oczekujących na przegląd
  - Lista ostatnich 10 sesji z wynikami
  - Skuteczność per kategoria (wykres radarowy)
- **Kluczowe komponenty:**
  - **Widżet „Szybki start"** — przycisk „Generuj Quiz" uruchamiający generowanie nowej sesji
  - **Widżet statystyk ogólnych** — karty z liczbami (łączne próby, skuteczność, sesje)
  - **Widżet „Pending Reviews"** — lista oflagowanych pytań z szybkim linkiem do edycji
  - **Wykres radarowy kategorii** — wizualizacja skuteczności per kategoria tematyczna (Vue island)
  - **Lista ostatnich sesji** — tabela z datą, wynikiem, statusem i linkiem do szczegółów
- **UX / Dostępność / Bezpieczeństwo:**
  - Renderowanie SSR (Astro) — szybki czas pierwszego malowania
  - Widżety interaktywne jako Vue islands (wykres, lista sesji z paginacją)
  - Subtelny indykator prywatności danych (ikona kłódki z tooltipem „Tylko Twoje dane")
  - Responsywny grid: 2 kolumny na desktop, 1 kolumna na mobile
  - Dane ładowane server-side (brak flickeringu)
- **Mapowanie API:** `GET /api/stats/overview`, `GET /api/stats/categories`, `GET /api/sessions`
- **Mapowanie US:** US-006

---

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

### 2.7. Widok gry — Podsumowanie rundy (Round Review)

- **Ścieżka:** `/game` (stan wewnętrzny Vue island: `review`)
- **Główny cel:** Porównanie odpowiedzi użytkownika z poprawnymi odpowiedziami AI i samoocena.
- **Kluczowe informacje:**
  - Lista 10 pytań z danej rundy
  - Odpowiedź AI (poprawna) vs. scratchpad użytkownika (side-by-side)
  - Czas odpowiedzi per pytanie
  - Aktualny wynik rundy
- **Kluczowe komponenty:**
  - **Lista pytań (side-by-side)** — dla każdego pytania: treść pytania, odpowiedź AI po lewej, scratchpad użytkownika po prawej (na mobile: stack vertically — odpowiedź AI na górze, scratchpad na dole)
  - **Przyciski werdyktu** — „Wiedziałem" (zielony) / „Nie wiedziałem" (czerwony) przy każdym pytaniu; obsługa skrótami klawiszowymi na desktop (np. `←`/`→` lub `1`/`2`); gestami (swipe) na mobile
  - **Przycisk flagowania** — ikona flagi otwierająca Popover z predefiniowanymi powodami (halucynacja AI, błędna odpowiedź, niejednoznaczne pytanie, inne) + opcjonalny komentarz
  - **Pasek wyników rundy** — na żywo aktualizowany scoring (np. „7/10")
  - **Przycisk „Następna runda"** — aktywny dopiero po oznaczeniu wszystkich 10 pytań
  - **Przycisk „Podsumowanie sesji"** — wyświetlany po ukończeniu 4. rundy zamiast „Następna runda"
- **UX / Dostępność / Bezpieczeństwo:**
  - **Tryb Review:** jasne tło, czytelny układ analityczny
  - Wszystkie 10 pytań muszą mieć werdykt przed przejściem dalej (walidacja front-endowa + back-endowa)
  - Wizualne wyróżnienie: zielone tło dla „Wiedziałem", czerwone dla „Nie wiedziałem"
  - Flagowanie nie wymaga opuszczania przepływu — Popover inline
  - Scroll do pierwszego nieoznaczonego pytania przy próbie przejścia dalej
- **Mapowanie API:** `POST /api/sessions/:sessionId/rounds/:roundId/complete`, `PATCH /api/attempts/:id`
- **Mapowanie US:** US-004, US-005

---

### 2.8. Widok gry — Podsumowanie sesji (Session Summary)

- **Ścieżka:** `/game` (stan wewnętrzny Vue island: `summary`)
- **Główny cel:** Prezentacja końcowego wyniku po ukończeniu wszystkich 4 rund.
- **Kluczowe informacje:**
  - Wynik łączny (np. 28/40)
  - Rozbicie wynikowe per runda (np. Runda 1: 8/10, Runda 2: 6/10…)
  - Skuteczność per kategoria
  - Czas średni per pytanie
- **Kluczowe komponenty:**
  - **Karta wyniku głównego** — duży, wycentrowany wynik z ikoną sukcesu/porażki
  - **Tabela rund** — wiersz per runda z wynikiem i średnim czasem
  - **Mini wykres kategorii** — uproszczona wersja wykresu radarowego z dashboardu, pokazująca skuteczność w bieżącej sesji
  - **Przyciski akcji:**
    - „Nowy quiz" → ponowne generowanie (`POST /api/generation-batches`)
    - „Wróć do dashboardu" → `/dashboard`
    - „Przejrzyj pytania" → `/questions` z prefiltrem na pytania z bieżącej sesji
- **UX / Dostępność / Bezpieczeństwo:**
  - Celebracja wyniku (animacja konfetti powyżej 80%?)
  - Czysty przegląd — łatwe porównanie wyników między rundami
  - Stan gry jest czyszczony z pamięci po opuszczeniu tego widoku
- **Mapowanie API:** `GET /api/sessions/:id`
- **Mapowanie US:** US-004, US-006

---

### 2.9. Panel pytań — Lista (Questions Master)

- **Ścieżka:** `/questions`
- **Główny cel:** Zarządzanie pełną bazą pytań — przeglądanie, filtrowanie, wyszukiwanie, flagowanie.
- **Kluczowe informacje:**
  - Lista pytań z kluczowymi metadata (status, typ, trudność, kategorie, data)
  - Filtry i sortowanie
  - Wyszukiwarka pełnotekstowa
- **Kluczowe komponenty:**
  - **Pasek filtrów** — dropdown status (`active | flagged | needs_review | verified | archived`), dropdown typ (`manual | ai`), dropdown kategoria, dropdown tag, suwak trudności (1-5), pole wyszukiwania `q`
  - **Lista pytań (zwirtualizowana)** — każdy element zawiera: skrót tekstu pytania, badge statusu (kolorystyczny: flagged=czerwony, verified=zielony z ikoną tarczy, needs_review=żółty), badge typu (AI/manual), trudność (gwiazdki/liczba), przypisane kategorie, datę utworzenia
  - **Przycisk „Dodaj pytanie"** — otwiera stronę tworzenia `/questions/new`
  - **Paginacja** — standardowa (page + limit) z informacją o łącznej liczbie wyników
  - **Sortowanie** — dropdown: najnowsze, najstarsze, trudność rosnąco, trudność malejąco
- **UX / Dostępność / Bezpieczeństwo:**
  - Wirtualizacja listy dla wydajności przy dużej bazie (>1000 pytań)
  - Kliknięcie wiersza → nawigacja do `/questions/:id`
  - Filtr „flagged" domyślnie podświetlony, gdy dashboard wskazuje `flagged_questions_pending > 0`
  - Responsywność: na mobile lista kompaktowa (tylko tekst + status badge)
  - Wizualna hierarchia: pytania Verified z ikoną tarczy, Raw bez oznaczenia
- **Mapowanie API:** `GET /api/questions`
- **Mapowanie US:** US-005

---

### 2.10. Panel pytań — Szczegóły / Edycja (Question Detail)

- **Ścieżka:** `/questions/:id`
- **Główny cel:** Podgląd i edycja pojedynczego pytania, przegląd historii zmian.
- **Kluczowe informacje:**
  - Pełna treść pytania i odpowiedzi
  - Metadata (status, trudność, typ, model źródłowy)
  - Przypisane kategorie i tagi
  - Historia edycji (audit log)
  - Załączony obraz (jeśli istnieje)
- **Kluczowe komponenty:**
  - **Formularz edycji** — textarea na treść pytania, pola odpowiedzi (primary + synonyms), selektor trudności (1-5), dropdown statusu, multi-select kategorii, multi-select tagów, pole `change_reason` (wymagane przy edycji)
  - **Upload obrazu** — drag-and-drop lub file picker do Supabase Storage; podgląd miniaturki
  - **Sekcja historii edycji** — timeline/lista zmian z datą, powodem i autorem
  - **Przycisk usunięcia** — z modalem potwierdzającym; zablokowany gdy pytanie ma powiązane attempts (komunikat: „Użyj archiwizacji zamiast usunięcia")
  - **Przyciski akcji:** „Zapisz zmiany", „Anuluj" (powrót do listy), „Flaguj" (zmiana statusu na flagged z Popoverem powodu)
- **UX / Dostępność / Bezpieczeństwo:**
  - Walidacja inline: treść pytania min. 10 znaków, trudność 1-5, poprawna odpowiedź wymagana
  - Toast notification po pomyślnym zapisie
  - Nawigacja breadcrumb: Dashboard → Pytania → [Treść pytania…]
  - Ostrzeżenie przed opuszczeniem strony z niezapisanymi zmianami
- **Mapowanie API:** `GET /api/questions/:id`, `PATCH /api/questions/:id`, `DELETE /api/questions/:id`
- **Mapowanie US:** US-005

---

### 2.11. Panel pytań — Tworzenie (Question Create)

- **Ścieżka:** `/questions/new`
- **Główny cel:** Ręczne dodanie nowego pytania do bazy.
- **Kluczowe informacje:** Formularz tworzenia pytania z wymaganymi polami.
- **Kluczowe komponenty:**
  - **Formularz tworzenia** — identyczna struktura jak formularz edycji (2.10), bez historii edycji i bez opcji usunięcia
  - **Upload obrazu** — opcjonalny
  - **Przycisk „Utwórz pytanie"** + „Anuluj"
- **UX / Dostępność / Bezpieczeństwo:**
  - Walidacja identyczna jak w edycji
  - Po utworzeniu: redirect na `/questions/:id` nowo utworzonego pytania z toast „Pytanie utworzone"
  - Obsługa limitu storage (`422`) — komunikat o przekroczeniu limitu pytań
  - Obsługa duplikatu (`409`) — komunikat „Pytanie o tej treści już istnieje"
- **Mapowanie API:** `POST /api/questions`
- **Mapowanie US:** US-005

---

### 2.12. Zarządzanie kategoriami

- **Ścieżka:** `/categories`
- **Główny cel:** CRUD na kategoriach tematycznych pytań.
- **Kluczowe informacje:** Lista kategorii z nazwą, opisem, liczbą przypisanych pytań, datą utworzenia.
- **Kluczowe komponenty:**
  - **Lista kategorii** — tabela/lista z kolumnami: nazwa, opis, data; klik → edycja inline lub modal
  - **Przycisk „Dodaj kategorię"** — otwiera modal z formularzem (nazwa 2-120 znaków, opis opcjonalnie)
  - **Akcje per wiersz:** edycja (modal), usunięcie (z modalem potwierdzającym — informacja o usunięciu powiązań z pytaniami)
- **UX / Dostępność / Bezpieczeństwo:**
  - Edycja inline lub w modalu (szybka interakcja)
  - Obsługa konfliktu slug (`409`) — „Kategoria o tej nazwie już istnieje"
  - Komunikat ostrzegawczy przy usunięciu: „Pytania przypisane do tej kategorii stracą to przypisanie"
- **Mapowanie API:** `GET /api/categories`, `POST /api/categories`, `PATCH /api/categories/:id`, `DELETE /api/categories/:id`

---

### 2.13. Zarządzanie tagami

- **Ścieżka:** `/tags`
- **Główny cel:** CRUD na tagach (etykietach) pytań.
- **Kluczowe informacje:** Lista tagów z nazwą i datą utworzenia.
- **Kluczowe komponenty:**
  - **Lista tagów** — prosta tabela/lista
  - **Przycisk „Dodaj tag"** — modal z polem nazwy
  - **Akcja usunięcia** — per wiersz, z potwierdzeniem
- **UX / Dostępność / Bezpieczeństwo:**
  - Obsługa konfliktu nazwy (`409`) — „Tag o tej nazwie już istnieje"
  - Minimalistyczny interfejs — tagi to lekkie etykiety
- **Mapowanie API:** `GET /api/tags`, `POST /api/tags`, `DELETE /api/tags/:id`

---

### 2.14. Ustawienia użytkownika

- **Ścieżka:** `/settings`
- **Główny cel:** Konfiguracja preferencji treningowych i wagowania kategorii.
- **Kluczowe informacje:**
  - Domyślny czas timera (15-30s)
  - Wagi kategorii (rozkład procentowy)
  - Limity storage (pytań, obrazów)
- **Kluczowe komponenty:**
  - **Slider timera** — zakres 15-30s z krokiem 1s, wyświetlanie aktualnej wartości
  - **Edytor wag kategorii** — lista kategorii z suwakami procentowymi; suma ≤ 100%; wizualna walidacja w czasie rzeczywistym
  - **Sekcja informacyjna storage** — read-only: limit pytań, wykorzystane miejsce na obrazy, pasek postępu użycia
  - **Przycisk „Zapisz"** + komunikat sukcesu
- **UX / Dostępność / Bezpieczeństwo:**
  - Walidacja sum wag kategorii w czasie rzeczywistym (suma > 100% blokuje zapis)
  - Jasne etykiety i opisy przy każdym ustawieniu
  - Autosave z debounce lub jawny przycisk zapisu
- **Mapowanie API:** `GET /api/user/preferences`, `PUT /api/user/preferences`

---

### 2.15. Historia sesji — Szczegóły

- **Ścieżka:** `/sessions/:id`
- **Główny cel:** Podgląd szczegółów zakończonej sesji treningowej.
- **Kluczowe informacje:**
  - Status sesji
  - Wynik per runda
  - Lista pytań, odpowiedzi i werdyktów
- **Kluczowe komponenty:**
  - **Nagłówek sesji** — data, status, łączny wynik
  - **Accordion rund** — każda runda rozwijalna z listą pytań, odpowiedziami i werdyktami
  - **Przycisk powrotu** — do dashboardu
- **UX / Dostępność / Bezpieczeństwo:**
  - Read-only — brak edycji w tym widoku
  - Link do edycji poszczególnych pytań (przejście do `/questions/:id`)
- **Mapowanie API:** `GET /api/sessions/:id`, `GET /api/sessions/:sessionId/rounds/:position`
- **Mapowanie US:** US-006

---

## 3. Mapa podróży użytkownika

### 3.1. Przepływ główny — Sesja treningowa

```
[/auth/signin] → uwierzytelnienie → [/dashboard]
        ↓
   Klik „Generuj Quiz"
        ↓
   [/game — stan: loading]
   POST /api/generation-batches
   Polling GET /api/generation-batches/:id
   POST /api/sessions (po sukcesie generowania)
        ↓
   [/game — stan: playing, runda 1]
   GET /api/sessions/:sessionId/rounds/1
   Pytanie 1/10 → Timer → Scratchpad → POST attempt
   Pytanie 2/10 → Timer → Scratchpad → POST attempt
   ...
   Pytanie 10/10 → Timer → Scratchpad → POST attempt
        ↓
   [/game — stan: review, runda 1]
   POST /api/sessions/:sessionId/rounds/:roundId/complete
   (odpowiedzi ujawnione)
   Samoocena 10 pytań: Wiedziałem / Nie wiedziałem
   Opcjonalne flagowanie pytań
   PATCH /api/attempts/:id (per pytanie)
        ↓
   Klik „Następna runda"
        ↓
   [/game — stan: playing, runda 2]
   ... (powtórzenie cyklu playing → review dla rund 2, 3, 4)
        ↓
   [/game — stan: summary]
   GET /api/sessions/:id
   Podsumowanie końcowe
        ↓
   „Wróć do dashboardu" → [/dashboard]
   lub „Nowy quiz" → [/game — stan: loading]
```

### 3.2. Przepływ zarządzania pytaniami

```
[/dashboard] → Klik „Pending Reviews" lub nawigacja „Pytania"
        ↓
   [/questions] — lista z prefiltrem (np. status=flagged)
        ↓
   Klik pytania → [/questions/:id]
   Edycja treści / odpowiedzi / statusu
   PATCH /api/questions/:id
        ↓
   Zapis → powrót do [/questions]
```

### 3.3. Przepływ tworzenia pytania manualnego

```
[/questions] → Klik „Dodaj pytanie"
        ↓
   [/questions/new]
   Wypełnienie formularza → POST /api/questions
        ↓
   Sukces → redirect [/questions/:id]
```

### 3.4. Przepływ rejestracji

```
[/] → redirect [/auth/signin]
   Klik „Zarejestruj się" → [/auth/signup]
   Wypełnienie formularza → POST /api/auth/signup
        ↓
   [/auth/confirm-email]
   Weryfikacja e-mail (link) → [/auth/signin]
        ↓
   Logowanie → [/dashboard]
```

### 3.5. Przepływ przerwania gry (Edge Case)

```
[/game — stan: playing]
   Odświeżenie strony / zamknięcie karty
        ↓
   beforeunload dialog: „Utracisz postęp. Kontynuować?"
        ↓
   Potwierdzenie → sesja abandoned (PATCH /api/sessions/:id)
   → [/dashboard]
        ↓
   Anulowanie → powrót do gry
```

---

## 4. Układ i struktura nawigacji

### 4.1. Layout główny (Tryb Standard)

Strona owinięta w `Layout.astro` z komponentem `Topbar.astro`:

```
┌─────────────────────────────────────────────────┐
│  Topbar                                          │
│  [Logo VARtownik]  Dashboard  Pytania  Kategorie │
│                    Tagi  Ustawienia     [Wyloguj] │
├─────────────────────────────────────────────────┤
│                                                   │
│  Treść strony (slot)                             │
│                                                   │
└─────────────────────────────────────────────────┘
```

- **Nawigacja główna (Topbar):**
  - Logo/Nazwa → `/dashboard`
  - Dashboard → `/dashboard`
  - Pytania → `/questions`
  - Kategorie → `/categories`
  - Tagi → `/tags`
  - Ustawienia → `/settings`
  - Wyloguj → `POST /api/auth/signout`
- **Aktywny link** wyróżniony wizualnie (podkreślenie lub zmiana koloru)
- **Mobile:** hamburger menu → rozwijane menu nawigacyjne

### 4.2. Layout Focus Mode (Tryb Gry)

Podczas aktywnego quizu (`/game` w stanie `playing`):

```
┌─────────────────────────────────────────────────┐
│  Minimalna belka:  Runda 2/4  •  Pytanie 5/10  │
├─────────────────────────────────────────────────┤
│                                                   │
│  [Timer]                                          │
│  [Treść pytania]                                 │
│  [Scratchpad]                                     │
│                                                   │
└─────────────────────────────────────────────────┘
```

- **Brak** standardowej nawigacji (Topbar ukryty)
- **Brak** linków wychodzących z trybu gry
- Minimalna belka statusu: numer rundy, numer pytania
- Powrót do nawigacji możliwy dopiero w stanie `review` lub `summary`

### 4.3. Layout Review Mode

Podczas przeglądania wyników rundy (`/game` w stanie `review`):

```
┌─────────────────────────────────────────────────┐
│  Belka: Podsumowanie Rundy 2/4   Wynik: 7/10   │
├─────────────────────────────────────────────────┤
│                                                   │
│  [Lista pytań z werdyktami]                      │
│  [Przycisk: Następna runda / Podsumowanie]       │
│                                                   │
└─────────────────────────────────────────────────┘
```

- Opcjonalny przycisk „Zakończ sesję" (abandon) w belce — z potwierdzeniem

### 4.4. Strony publiczne vs chronione

| Ścieżka | Dostęp | Middleware |
|---|---|---|
| `/` | Publiczna (redirect do `/dashboard` lub `/auth/signin`) | — |
| `/auth/*` | Publiczna | Redirect do `/dashboard` jeśli zalogowany |
| `/dashboard` | Chroniona | Wymaga sesji |
| `/game` | Chroniona | Wymaga sesji |
| `/questions`, `/questions/*` | Chroniona | Wymaga sesji |
| `/categories` | Chroniona | Wymaga sesji |
| `/tags` | Chroniona | Wymaga sesji |
| `/settings` | Chroniona | Wymaga sesji |
| `/sessions/:id` | Chroniona | Wymaga sesji |

---

## 5. Kluczowe komponenty

### 5.1. Komponenty współdzielone (cross-view)

| Komponent | Typ | Opis |
|---|---|---|
| `Topbar` | Astro | Główna nawigacja z linkami, logo i przyciskiem wylogowania. Ukrywany w Trybie Focus. |
| `LibBadge` | Astro | Uniwersalny badge (status, kategoria, trudność) z wariantami kolorystycznymi. |
| `Toast` | Vue | Powiadomienia o akcjach (zapis, błąd, sukces). Globalny kontener toast notifications. |
| `ConfirmDialog` | Vue | Modal potwierdzenia destrukcyjnych operacji (usunięcie pytania, abandon sesji). |
| `EmptyState` | Astro | Ekran pustego stanu z ikoną, komunikatem i CTA (np. „Nie masz jeszcze pytań. Wygeneruj quiz!"). |
| `Pagination` | Vue | Komponent paginacji z nawigacją page/limit i informacją o łącznej liczbie wyników. |
| `FormField` | Vue | Wrapper na pole formularza z labelką, walidacją inline i komunikatem błędu. |

### 5.2. Komponenty silnika gry

| Komponent | Typ | Opis |
|---|---|---|
| `GameShell` | Vue | Kontener główny gry — zarządza maszyną stanów (loading → playing → review → summary), przechowuje stan sesji, obsługuje `beforeunload`. Montowany jako island na stronie `/game`. |
| `GenerationLoader` | Vue | Ekran ładowania z fazowymi komunikatami, karuzelą ciekawostek i obsługą błędów. |
| `QuestionCard` | Vue | Wyświetla treść pytania z fluid typography, badge kategorii i opcjonalnym obrazem. |
| `TimerBar` | Vue | Wizualny timer (pasek / okrąg) z progresją kolorystyczną i `aria-live` dla ostatnich sekund. |
| `Scratchpad` | Vue | Pole tekstowe odpowiedzi z autofocus, blokadą po timeout, adaptacją mobile (`visualViewport`). |
| `RoundReview` | Vue | Lista 10 pytań w widoku side-by-side (scratchpad vs AI answer) z przyciskami werdyktu. |
| `VerdictButtons` | Vue | Para przycisków „Wiedziałem" / „Nie wiedziałem" ze skrótami klawiszowymi. |
| `FlagPopover` | Vue | Popover flagowania z predefiniowanymi powodami i opcjonalnym komentarzem. |
| `SessionSummary` | Vue | Ekran końcowy sesji z wynikiem, rozbiciem per runda i przyciskami akcji. |
| `RoundProgressDots` | Vue | Wizualny wskaźnik postępu pytań w rundzie (dots / stepper). |

### 5.3. Komponenty CRUD / Dashboard

| Komponent | Typ | Opis |
|---|---|---|
| `StatsOverviewCards` | Vue | Karty z kluczowymi metrykami (łączna skuteczność, sesje, pending reviews). |
| `CategoryRadarChart` | Vue | Wykres radarowy skuteczności per kategoria. |
| `RecentSessionsList` | Vue | Tabela ostatnich 10 sesji z datą, wynikiem i statusem. |
| `PendingReviewsWidget` | Vue | Lista oflagowanych pytań z szybkim linkiem do edycji. |
| `QuestionListFilters` | Vue | Pasek filtrów (status, typ, kategoria, tag, trudność, search). |
| `QuestionListItem` | Vue | Wiersz listy pytań z skróconym tekstem, badge'ami statusu/typu i metadata. |
| `QuestionForm` | Vue | Formularz tworzenia/edycji pytania (współdzielony między `/questions/new` a `/questions/:id`). |
| `EditHistoryTimeline` | Vue | Timeline historii edycji pytania z datami i powodami zmian. |
| `CategoryWeightsEditor` | Vue | Edytor wag kategorii z suwakami i walidacją sumy ≤ 100%. |
| `TimerSlider` | Vue | Slider ustawienia domyślnego timera (15-30s). |
