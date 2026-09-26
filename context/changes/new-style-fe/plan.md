# Spójny jasny motyw VARtownika — plan implementacji

## Przegląd

Nadać wszystkim obecnym widokom VARtownika jasny, neutralny styl inspirowany Uberem: białe i jasnoszare powierzchnie, ciemna typografia i czarne akcje główne. Zachować układy, przepływy i dane; uporządkować typografię, odstępy, karty oraz stany interakcji. Stronę `/` zastąpić krótką stroną produktu, a widoczne angielskie etykiety nawigacji i potwierdzenia e-mail przetłumaczyć na polski.

## Analiza stanu obecnego

- `src/styles/global.css:15` definiuje tokeny shadcn-vue, lecz `--primary`, `--ring`, wykresy i poboczne zestawy focus/dashboard/CRUD zawierają fiolet. `src/layouts/Layout.astro:1` importuje ten CSS wszędzie; nigdzie nie aktywuje `.dark`.
- Strony `/`, `/auth/*` i `/dashboard` wpisują gradienty oraz białe teksty bezpośrednio w klasach (`src/components/Welcome.astro:18`, `src/pages/auth/signin.astro:8`, `src/pages/dashboard.astro:64`). Zmiana samych tokenów nie usunie obecnego wyglądu.
- Wykres ma fioletowe dane i białe osie w konfiguracji Chart.js (`src/components/dashboard/CategoryRadarChart.vue:107`). Formularze auth nadpisują kolory shadcn Input i Button (`src/components/auth/SignInForm.vue:84`, `src/components/auth/SignUpForm.vue:101`).
- Istniejące komponenty shadcn-vue to Button, Input, Badge i Table; `QuickStartWidget.astro:29` pokazuje użycie `buttonVariants` w Astro. `components.json` wskazuje styl `new-york`, bazę `neutral` i zmienne CSS.
- Gra (`/game`) korzysta głównie z tokenów, ale ma wiele stanów: generowanie, błąd z ponowieniem, quiz, licznik i zablokowane pole odpowiedzi (`src/components/game/GameView.vue:303`, `src/components/game/GenerationErrorMessage.vue:91`, `src/components/game/TimerWidget.vue:27`).
- Selektory `[data-mode="focus|dashboard|crud"]` w `src/styles/global.css:214` nie mają żadnego konsumenta w `src/`. Linki do `/questions/...` i `/sessions/:id` istnieją w dashboardzie, ale odpowiadające im strony jeszcze nie istnieją.
- Badanie opisuje commit `b9fbb0d`, a aktualny HEAD to `b80cfe8`. Różnice w kontrakcie statusu pytań nie zmieniają powierzchni wizualnej tej pracy.

## Pożądany stan końcowy

Wszystkie istniejące trasy: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/dashboard` i `/game` mają wspólną jasną hierarchię powierzchni i akcji. Neutralna paleta obsługuje zwykły interfejs; zieleń, bursztyn i czerwień oznaczają wyłącznie wynik, ostrzeżenie lub błąd. Radar pozostaje wykresem radarowym, a wartości kategorii są czytelne także jako tekst. Stany ładowania, braku danych, walidacji, błędu, focus i disabled są spójne oraz czytelne na desktopie i telefonie.

### Kluczowe odkrycia

- `src/styles/global.css:166` już mapuje tokeny semantyczne na klasy Tailwind 4; to centralne miejsce palety.
- `src/components/dashboard/RecentSessionsTable.vue:105` i `src/components/dashboard/CategoryRadarChart.vue:152` mieszają komponenty shadcn z lokalnymi kolorami; wymagają osobnego przejścia po klasach.
- `src/components/dashboard/PendingReviewsWidget.astro:51`, `src/components/dashboard/RecentSessionsTable.vue:151` i `src/components/dashboard/StatsOverviewWidget.astro:34` usuwają obrys focus bez zastępczego wskaźnika.
- `src/components/auth/PasswordStrengthIndicator.vue:16` zakłada ciemne tło dla nieaktywnych segmentów; to osobny przypadek przy jasnym auth.
- `src/components/Welcome.astro:29` nadal pokazuje treść startera, a `src/layouts/Layout.astro:11` ustawia `lang="en"` mimo polskiego interfejsu.

## Czego nie robimy

- Nie dodajemy nieistniejących dziś stron CRUD, szczegółów sesji ani podsumowania rundy. Istniejące linki do nich pozostają poza zakresem tej zmiany.
- Nie zmieniamy logiki auth, generowania pytań, API, danych statystyk, reguł gry ani układów i przepływów stron.
- Nie budujemy przełącznika motywu ani osobnego wariantu ciemnego.
- Nie zastępujemy radaru innym rodzajem wykresu i nie dodajemy nowych metryk.

## Podejście do implementacji

Najpierw ustalić jeden zestaw jasnych tokenów shadcn-vue dla tła, kart, tekstu, obramowań, akcji i focus oraz kilka jawnych tokenów semantycznych dla sukcesu i ostrzeżenia. Praktyczny punkt odniesienia to tło bliskie `#F6F6F6`, biała karta, tekst i akcja bliskie `#171717`, tekst pomocniczy bliski `#525252`; ostateczne wartości muszą spełnić kontrast na realnych powierzchniach. Usunąć nieużywane palety `data-mode` i fioletową deklarację `.dark`, by w CSS został jeden aktywny system, bez martwych wzorców projektowych.

W Vue użyć istniejących Button, Input, Badge i Table oraz ich wariantów bez lokalnych nadpisań koloru; w Astro używać semantycznych klas i `buttonVariants` dla odsyłaczy wyglądających jak przyciski. Zachować obecny układ każdej strony, ale zastąpić gradienty i szklane panele prostymi powierzchniami. Kolory znaczące stan zawsze łączyć z tekstem, liczbą lub ikoną. Zmiany wprowadzać i weryfikować widok po widoku.

## Krytyczne szczegóły implementacji

**Kolory canvas.** Chart.js rysuje na canvas, więc sam zapis `var(--token)` jako koloru datasetu może nie zostać poprawnie rozpoznany. Konfiguracja wykresu ma otrzymać rozstrzygnięte wartości aktualnych tokenów CSS po zamontowaniu wyspy Vue, bez niezależnej fioletowej palety w JavaScript.

## Faza 1: Wspólny system wizualny

### Przegląd

Zdefiniować jasną paletę, kontrast i wzorce akcji, które kolejne fazy będą stosować w widokach.

### Wymagane zmiany

#### 1. Tokeny i nieużywane palety

**Plik:** `src/styles/global.css`

**Cel:** Zastąpić fioletowe tokeny neutralnym systemem i usunąć nieużywane zestawy focus/dashboard/CRUD oraz ciemne deklaracje, żeby cały aktywny interfejs miał jedno źródło kolorów.

**Kontrakt:** `--background`, `--foreground`, `--card`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--destructive` i tokeny wykresu dają czytelny jasny motyw. Dodać i mapować semantyczne tokeny sukcesu oraz ostrzeżenia; nie stosować ich dla zwykłych akcji. Aktywne i pozostałe deklaracje nie zawierają fioletowej palety. Kontrast zwykłego tekstu co najmniej 4,5:1, dużego tekstu i elementów nie tekstowych co najmniej 3:1 na docelowych powierzchniach.

#### 2. Wspólny dokument i stany focus

**Plik:** `src/layouts/Layout.astro`, `src/components/ui/button/index.ts`, `src/components/ui/input/Input.vue`, `src/components/ui/badge/index.ts`

**Cel:** Ustawić język dokumentu na polski i zachować czytelne warianty prymitywów shadcn przy czarnym akcencie.

**Kontrakt:** `<html lang="pl">`; akcje default, secondary, outline, ghost, disabled i `focus-visible` mają czytelne tło, tekst, obrys oraz hover na jasnym tle. Zmieniać definicje komponentów tylko tam, gdzie same tokeny nie wystarczą; publiczne API wariantów pozostaje bez zmian.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm run lint` i `npm run build` przechodzą po zmianie tokenów i layoutu.
- W `src/styles/global.css` nie ma fioletowych wartości ani selektorów `data-mode`; klasy semantyczne Tailwind nadal są mapowane.

#### Weryfikacja ręczna

- Próbki Button, Input i Badge na jasnym tle pokazują czytelny tekst oraz widoczny focus przy nawigacji klawiaturą; neutralne i semantyczne pary kolorów spełniają wskazany kontrast.

## Faza 2: Strona startowa i uwierzytelnianie

### Przegląd

Wprowadzić nowy wygląd publicznej strony produktu i wszystkich ekranów auth, zachowując dotychczasowe formularze oraz przekierowania.

### Wymagane zmiany

#### 1. Publiczna strona VARtownika

**Plik:** `src/pages/index.astro`, `src/components/Welcome.astro`, `src/components/Topbar.astro`, `src/components/ui/LibBadge.astro`

**Cel:** Zastąpić treść o stosie technologicznym krótkim opisem produktu i spójną nawigacją. Usunąć gradienty, szklane panele i techniczne badge, które nie należą do nowej strony.

**Kontrakt:** Hero nazywa VARtownik treningiem wiedzy piłkarskiej; zwięźle opisuje quiz i podgląd postępów bez obietnic nieistniejących funkcji. Główna akcja prowadzi zalogowanego użytkownika do `/dashboard`, a niezalogowanego do `/auth/signup`; nawigacja daje dostęp do logowania. Topbar ma polskie etykiety i działa dla obu stanów sesji. Układ zachowuje responsywną strukturę strony startowej bez nowych przepływów.

#### 2. Ekrany auth i stany formularzy

**Plik:** `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SignInForm.vue`, `src/components/auth/SignUpForm.vue`, `src/components/auth/PasswordStrengthIndicator.vue`

**Cel:** Ujednolicić jasne karty, pola, akcje i komunikaty oraz przetłumaczyć widoczną treść potwierdzenia e-mail. Zachować semantyczne kolory walidacji i siły hasła na jasnym tle.

**Kontrakt:** Logowanie, rejestracja oraz warianty DEV/produkcyjny potwierdzenia e-mail zachowują dotychczasowe URL i zachowanie. Formularze nadal używają shadcn Input/Button; znikają lokalne fioletowe nadpisania. Widoczne są etykiety, komunikaty błędu, stan wysyłania, focus, disabled i segmenty siły hasła. Treść `/auth/confirm-email` jest po polsku w obu wariantach.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm run lint` i `npm run build` przechodzą; skan klas widoków publicznych i auth nie wykazuje fioletowych lub niebieskich akcentów starego motywu.

#### Weryfikacja ręczna

- `/`, `/auth/signin`, `/auth/signup` i `/auth/confirm-email` są czytelne na telefonie i desktopie; Topbar oraz CTA kierują do właściwych obecnych tras.
- Walidacja, błąd sieci, wysyłanie, wskaźnik siły hasła i focus klawiatury pozostają zrozumiałe na jasnych powierzchniach.

## Faza 3: Dashboard i wizualizacja danych

### Przegląd

Przenieść wszystkie karty, tabelę, filtry oraz radar na wspólny system wizualny bez zmiany danych i zapytań.

### Wymagane zmiany

#### 1. Powierzchnie dashboardu i stany statystyk

**Plik:** `src/pages/dashboard.astro`, `src/components/dashboard/QuickStartWidget.astro`, `src/components/dashboard/StatsOverviewWidget.astro`, `src/components/dashboard/StatCard.astro`, `src/components/dashboard/PendingReviewsWidget.astro`

**Cel:** Zastąpić ciemny gradient i półprzezroczyste karty prostymi jasnymi powierzchniami. Zachować hierarchię danych, ale ograniczyć kolory wyników i ostrzeżeń do semantycznych przypadków.

**Kontrakt:** Siatka, dane, liczby i istniejące odsyłacze pozostają; karty używają tokenów tła, tekstu i obramowania. Stany błędu statystyk, pustej kolejki i liczby oczekujących są czytelne tekstem, nie samym kolorem. Linki i przycisk odświeżania mają widoczny `focus-visible`.

#### 2. Tabela sesji

**Plik:** `src/components/dashboard/RecentSessionsTable.vue`

**Cel:** Pozostawić shadcn Table/Badge i zastąpić lokalne białe/fioletowe klasy tokenami, także w paginacji i spinnerze.

**Kontrakt:** Nie zmienia się paginacja, format danych ani URL szczegółów. Tabela, etykiety statusów, loading, error, empty, disabled oraz oba przyciski stron są czytelne na jasnym tle; aktywne elementy mają widoczny focus. Link do przyszłego `/sessions/:id` pozostaje bez zmiany działania.

#### 3. Radar i tekstowy odczyt danych

**Plik:** `src/components/dashboard/CategoryRadarChart.vue`

**Cel:** Dopasować wykres, etykiety, siatkę, tooltip i filtry dat do neutralnej palety oraz udostępnić wartości także bez odczytywania canvas.

**Kontrakt:** Zachować radar, dane procentowe i dotychczasowy filtr dat. Dataset i osie korzystają z rozstrzygniętych tokenów; pod wykresem pojawia się zwięzła lista `kategoria — skuteczność (%)` dla aktualnie wybranego okresu. Lista aktualizuje się wraz z wykresem. Błąd walidacji dat, błąd pobierania, brak danych, spinner, focus pól dat i tooltip mają czytelne stany.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm run lint` i `npm run build` przechodzą; w komponentach dashboardu i konfiguracji Chart.js nie pozostały stałe fioletowe/białe kolory poprzedniego motywu.

#### Weryfikacja ręczna

- Dashboard z danymi i bez danych jest czytelny na telefonie i desktopie; kolejka, statystyki, tabela oraz formularz dat mają widoczny focus i właściwy kontrast.
- Lista kategorii odpowiada wartościom radaru po zmianie okresu; loading, błędy, pusta lista i paginacja zachowują sens wizualny oraz działanie.

## Faza 4: Gra i końcowy przegląd

### Przegląd

Sprawdzić i domknąć jasny styl wszystkich stanów gry oraz spójność sześciu tras.

### Wymagane zmiany

#### 1. Generowanie i quiz

**Plik:** `src/pages/game.astro`, `src/components/game/GenerationLoadingScreen.vue`, `src/components/game/LoadingPhaseIndicator.vue`, `src/components/game/FootballFactCarousel.vue`, `src/components/game/GenerationErrorMessage.vue`, `src/components/game/QuizFocusMode.vue`, `src/components/game/QuestionBlock.vue`, `src/components/game/Scratchpad.vue`, `src/components/game/QuestionProgressIndicator.vue`, `src/components/game/RoundHeader.vue`, `src/components/game/TimerWidget.vue`

**Cel:** Utrzymać spójność jasnych powierzchni, postępu i akcji także podczas generowania, błędu i odpowiedzi. Rozdzielić kolor trudności od koloru błędu i zachować znaczenie progów licznika.

**Kontrakt:** Przepływ gry, timery, retry/cancel i zapisy prób nie zmieniają zachowania. Trudność pytania nie używa wariantu `destructive` tylko dlatego, że jest wysoka; czerwony oznacza błąd lub krytyczny czas. Zielony/bursztynowy/czerwony licznik nadal ma widoczną liczbę sekund i progi. Pole odpowiedzi oraz retry mają czytelne focus i disabled; wskaźniki postępu oraz karuzela nie opierają znaczenia wyłącznie na kolorze. Animacje dekoracyjne respektują `prefers-reduced-motion`.

#### 2. Przegląd końcowy tras i kontrastu

**Plik:** wszystkie zmienione pliki `src/pages/`, `src/components/` i `src/styles/global.css`

**Cel:** Wyłapać pozostałości starego motywu oraz regresje dostępności i responsywności po połączeniu faz.

**Kontrakt:** Wszystkie sześć tras, ich dostępne stany i aktywne elementy są sprawdzone według macierzy w strategii testowania. Nie planować prac na nieistniejących trasach; zgłosić je jako istniejące ograniczenie produktu.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm test`, `npm run lint` i `npm run build` przechodzą; skan aktywnych plików widoków nie wykazuje fioletowych klas ani stałych koloru starego motywu.

#### Weryfikacja ręczna

- Generowanie, błąd i retry, quiz, wygasanie czasu, zablokowane pole oraz powrót do dashboardu działają i pozostają czytelne.
- Wszystkie sześć tras przechodzi przegląd na telefonie i desktopie, także klawiaturą i przy ograniczonym ruchu; zwykły tekst osiąga kontrast 4,5:1, duży tekst i elementy nietekstowe 3:1.

## Strategia testowania

### Testy automatyczne

- Uruchomić `npm test` dla istniejących kontraktów funkcjonalnych, `npm run lint` i `npm run build`. Ta zmiana nie dodaje logiki biznesowej; nie tworzyć testów, które jedynie sprawdzają dosłowne nazwy klas.
- Wykonać skan źródeł aktywnych widoków na stare klasy `purple|violet|indigo`, gradienty starego motywu oraz kolory RGBA wykresu. Oceniać trafienia semantycznie, bo zielony/bursztynowy/czerwony pozostają celowe.

### Testy ręczne

1. `/`: anonimowy i zalogowany Topbar oraz właściwy cel CTA; ekran mobilny i desktopowy.
2. `/auth/signin`, `/auth/signup`, `/auth/confirm-email`: formularz pusty, błędy walidacji i sieci, wysyłanie, siła hasła, oba warianty potwierdzenia.
3. `/dashboard`: dane i brak danych, awaria SSR, pusta kolejka, radar z zakresem poprawnym i błędnym, ładowanie/błąd wykresu, pusta tabela i paginacja.
4. `/game`: wszystkie fazy generowania, błąd i retry, quiz z pytaniem, progi timera, wygasanie, disabled oraz nawigacja końcowa.
5. Dla każdej trasy: wąski i szeroki viewport, kolejność Tab, widoczny focus, kontrast tekstu i wskaźników, `prefers-reduced-motion`.

## Uwagi dotyczące wydajności

Zmiana powinna używać CSS i istniejących wysp Vue; nie dodawać nowych bibliotek ani hydratacji statycznych kart Astro. Tekstowa lista kategorii korzysta z danych radaru, bez dodatkowego zapytania API. Usunięcie martwych selektorów zmniejsza CSS.

## Uwagi dotyczące migracji i wycofania

Brak migracji danych lub zmian API. Cofnięcie tej zmiany to przywrócenie poprzednich plików frontendu; zachować funkcjonalne endpointy i kształt DTO. Wdrożenie może być przyrostowe w czterech fazach, lecz wizualnie spójny rezultat wymaga ukończenia wszystkich.

## Referencje

- `context/changes/new-style-fe/change.md` — cel zmiany.
- `context/changes/new-style-fe/research.md` — inwentarz widoków i kolorów.
- `src/styles/global.css:15` — tokeny i mapowanie Tailwind 4.
- `src/components/dashboard/CategoryRadarChart.vue:107` — osobna paleta Chart.js.
- `src/components/dashboard/QuickStartWidget.astro:29` — użycie wariantu shadcn Button w Astro.
- `src/components/game/GameView.vue:303` — rozgałęzienie stanów gry.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Wspólny system wizualny

#### Automated

- [x] 1.1 Uruchomić lint i build po zmianie tokenów i layoutu
- [x] 1.2 Sprawdzić brak fioletowych wartości i nieużywanych selektorów w global.css

#### Manual

- [ ] 1.3 Sprawdzić kontrast i focus wariantów Button, Input oraz Badge

### Phase 2: Strona startowa i uwierzytelnianie

#### Automated

- [ ] 2.1 Uruchomić lint i build oraz skan starych akcentów w publicznych widokach i auth

#### Manual

- [ ] 2.2 Sprawdzić stronę startową, CTA, Topbar i cztery trasy na telefonie oraz desktopie
- [ ] 2.3 Sprawdzić stany formularzy, siłę hasła i focus klawiatury

### Phase 3: Dashboard i wizualizacja danych

#### Automated

- [ ] 3.1 Uruchomić lint i build oraz skan kolorów dashboardu i Chart.js

#### Manual

- [ ] 3.2 Sprawdzić kontrast i focus dashboardu z danymi, bez danych i przy błędach
- [ ] 3.3 Sprawdzić zgodność listy kategorii z radarem, filtry, loading i paginację

### Phase 4: Gra i końcowy przegląd

#### Automated

- [ ] 4.1 Uruchomić testy, lint, build i końcowy skan starego motywu

#### Manual

- [ ] 4.2 Sprawdzić generowanie, błąd, retry, quiz, timer i disabled
- [ ] 4.3 Sprawdzić wszystkie trasy w dwóch viewportach, klawiaturą i przy ograniczonym ruchu
