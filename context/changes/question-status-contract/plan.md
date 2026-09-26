# Plan implementacji: question-status-contract

## Przegląd

Ustalić jeden kontrakt statusów pytań dla przyszłego flagowania z podsumowania rundy i zarządzania bankiem. Pytanie oczekujące na przegląd ma status `flagged`, a po świadomym rozwiązaniu `verified`. Pytania `flagged` i `archived` nie mogą wejść do nowej sesji; istniejąca sesja zachowuje swój zestaw pytań.

## Analiza stanu obecnego

- Enum zawiera `active`, `flagged`, `needs_review`, `verified`, `archived`, a nowe pytania domyślnie dostają `active` (`supabase/migrations/20260301000000_baseline_schema.sql:44`, `:327`, `src/lib/services/questions.service.ts:145`).
- Trigger próby zapisuje `needs_review`, lecz dashboard i licznik oczekujących czytają tylko `flagged` (`supabase/migrations/20260301000000_baseline_schema.sql:129`, `src/pages/dashboard.astro:35`, `src/pages/api/stats/overview.ts:47`). To ukryłoby zgłoszenia z przyszłego S-02.
- `PATCH /api/questions/:id` przyjmuje każdy status z enuma, a serwis przypisuje go bez kontroli przejść. Trasy pytań używają testowego identyfikatora użytkownika zamiast uwierzytelnionej tożsamości (`src/pages/api/questions/[id].ts:23`, `:33`, `src/lib/services/questions.service.ts:311`).
- Generator tworzy nowe pytania `active` i nie losuje pytań z istniejącego banku. Sprawdza duplikaty po `content_hash` bez względu na status (`src/lib/services/generation-batch.service.ts:328`, `:344`, `:374`). PRD opisuje przyszły dobór z banku, ale aktualny kod go nie realizuje (`context/foundation/prd.md`, sekcja Business Logic Changes).
- Ten sam udany batch może posłużyć do utworzenia kolejnej sesji; `createSession()` nie sprawdza bieżących statusów pytań z jego `response_payload` (`src/lib/services/sessions.service.ts:150`). Runda już rozpoczęta czyta pytania po zapisanych identyfikatorach, niezależnie od statusu (`src/lib/services/rounds.service.ts:143`).
- `SECURITY DEFINER` trigger flagowania aktualizuje pytanie po samym `question_id`. RLS próby sprawdza `attempts.user_id`, lecz nie wiąże go z właścicielem pytania (`supabase/migrations/20260301000000_baseline_schema.sql:129`, `:846`).

## Pożądany stan końcowy

| Status | Znaczenie | Nowa sesja z pytaniem | Do kolejki przeglądu |
| --- | --- | --- | --- |
| `active` | nowe lub ręcznie przywrócone | tak | nie |
| `flagged` | zgłoszone, nierozwiązane | nie | tak |
| `verified` | ręcznie rozwiązane, także po fałszywym alarmie | tak | nie |
| `archived` | wycofane z obiegu | nie | nie |
| `needs_review` | stary alias | nie występuje po migracji | migrowane do `flagged` |

Dozwolone przejścia: `active|verified → flagged`, `flagged → verified`, `active|verified|flagged → archived`, `archived → active` tylko po jawnej akcji przywrócenia. Ponowne zgłoszenie `verified` wraca do `flagged`. Edycja treści, odpowiedzi lub metadanych `flagged` nie rozwiązuje zgłoszenia; rozwiązanie jest osobną akcją, również bez edycji. Niezmieniony status jest idempotentny. `needs_review` pozostaje w enumie dla zgodności schematu, lecz nie może być nowo zapisywany.

### Kluczowe odkrycia

- Wpis `attempts.is_flagged_by_user` jest już przewidziany w bazie i DTO, lecz dzisiejsze tworzenie próby ustawia go na `false`; S-02 dostarczy interfejs i endpoint aktualizacji (`src/types.ts:355`, `src/lib/services/attempts.service.ts:76`).
- Twarde usunięcie pytania z próbami już zwraca `409` i zaleca archiwizację; FK do `attempts` ogranicza usuwanie (`src/lib/services/questions.service.ts:412`, `supabase/migrations/20260301000000_baseline_schema.sql:584`).
- `last_verified_at` i `updated_at` istnieją, ale przejścia statusu ich dziś nie utrzymują (`supabase/migrations/20260301000000_baseline_schema.sql:336`).

## Czego nie robimy

- Nie budujemy ekranu podsumowania, formularza flagowania, panelu banku ani ręcznego dodawania; należą do S-02, S-04 i S-05.
- Nie zmieniamy promptu, wywołań AI, polityki retry ani dystrybucji 40 pytań. Nie dodajemy obecnie nieistniejącego losowania z banku.
- Nie zmieniamy zestawu pytań w sesji już utworzonej i nie usuwamy historycznych prób.
- Nie usuwamy wartości `needs_review` z enuma PostgreSQL ani istniejących kolumn.

## Podejście do implementacji

Reguła przejść ma być egzekwowana w bazie, bo status może zmienić zarówno API, jak i trigger próby. Serwis pytań waliduje ją wcześniej, by zwrócić czytelny błąd HTTP. Migracja normalizuje stare `needs_review`, aktualizuje trigger flagowania i zabezpiecza właściciela. Osobny warunek przy tworzeniu sesji odrzuca stary batch zawierający pytanie, które w międzyczasie stało się `flagged` lub `archived`. Dashboard, lista i licznik używają tego samego znaczenia `flagged`.

## Krytyczne szczegóły implementacji

**Sekwencjonowanie stanu.** Walidacja statusów pytań batcha musi zachodzić w transakcji wstawiającej nową sesję, z blokadą odczytywanych rekordów pytań. Sam odczyt w serwisie przed `INSERT` pozostawia okno, w którym równoległe flagowanie może przepuścić wykluczone pytanie. Flagowanie po utworzeniu sesji nie zmienia jej już ustalonego zestawu.

## Faza 1: Kanoniczny status i bezpieczny trigger

### Przegląd

Znormalizować historyczne dane oraz egzekwować stan pytania w PostgreSQL, także gdy flagę zapisze przyszły endpoint S-02.

### Wymagane zmiany

#### 1. Migracja statusów

**Plik:** `supabase/migrations/20260926170000_question_status_contract.sql`

**Cel:** Przenieść istniejące `needs_review` do `flagged`, zachować wszystkie pytania i enum oraz zablokować powstawanie nowego aliasu. Utrzymywać `updated_at` przy zmianie pytania i `last_verified_at` przy przejściu do `verified`.

**Kontrakt:** Baza dopuszcza tylko tabelę przejść opisaną wyżej. Próba ustawienia `needs_review`, niedozwolone przejście lub połączenie edycji treści z rozwiązaniem flagi jest odrzucane. `last_verified_at` zapisuje ostatni moment zatwierdzenia i pozostaje historią po późniejszym ponownym zgłoszeniu.

#### 2. Trigger flagowania próby

**Plik:** `supabase/migrations/20260926170000_question_status_contract.sql`

**Cel:** Zastąpić efekt `needs_review` kanonicznym `flagged` oraz usunąć możliwość zmiany cudzego pytania przez funkcję `SECURITY DEFINER`.

**Kontrakt:** Tylko zmiana flagi próby z `false` na `true` może zmienić status pytania; pytanie i próba muszą mieć tego samego właściciela. `active` i `verified` przechodzą do `flagged`; `flagged` pozostaje bez zmiany, a `archived` nie wraca automatycznie do obiegu. Inna aktualizacja próby nie ponawia starej flagi.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Test SQL na lokalnej, odtwarzalnej bazie potwierdza migrację `needs_review → flagged` bez utraty wierszy i odrzucenie nowych zapisów aliasu.
- Test SQL potwierdza przejścia, ponowne flagowanie `verified`, brak reaktywacji `archived`, aktualizację znaczników czasu oraz brak zmiany cudzego pytania przez trigger.

#### Weryfikacja ręczna

- Po migracji rzeczywiste wcześniejsze pytania `needs_review` są widoczne w kolejce `flagged`, a liczba pytań i prób nie spada.

## Faza 2: API przejść i blokada ponownego startu batcha

### Przegląd

Uwierzytelniona ścieżka HTTP udostępnia jawne przejścia, a nowa sesja nie może powstać z wykluczonym pytaniem.

### Wymagane zmiany

#### 1. Kontrakt aplikacyjny statusu

**Plik:** `src/lib/question-status.ts`, `src/types.ts`, `src/lib/services/questions.service.ts`

**Cel:** Zdefiniować kanoniczne statusy dla API, kolejki i przyszłego doboru z banku oraz odrzucać niepoprawne przejścia przed zapisem. Zachować historię edycji przy ręcznej zmianie statusu.

**Kontrakt:** API zapisu przyjmuje `active|flagged|verified|archived`, a `needs_review` odrzuca. `flagged → verified` jest osobnym żądaniem z `change_reason`, dopuszczalnym bez edycji; edycja `flagged` bez takiego żądania pozostawia status. Niedozwolona zmiana kończy się `409`, a obce pytanie `404`. `active` i `verified` są jedynymi statusami kwalifikującymi pytanie do przyszłego doboru z banku.

#### 2. Uwierzytelnienie tras pytań

**Plik:** `src/pages/api/questions/index.ts`, `src/pages/api/questions/[id].ts`

**Cel:** Usunąć testowy identyfikator użytkownika ze wszystkich metod tras, zanim przejścia statusu będą używane przez UI. Ujednolicić schematy zapisu i filtrowania z kanonicznym kontraktem.

**Kontrakt:** Brak `locals.user` daje `401`; odczyt i zapis używają `locals.user.id`; obce zasoby są niewidoczne. `PATCH` mapuje błąd przejścia na `409`, a `GET ?status=flagged` pozostaje filtrem nierozwiązanych zgłoszeń.

#### 3. Weryfikacja batcha przy starcie sesji

**Plik:** `supabase/migrations/20260926171000_session_question_eligibility.sql`, `src/lib/services/sessions.service.ts`, `src/pages/api/sessions/index.ts`

**Cel:** Zablokować ponowne użycie udanego batcha, jeśli którekolwiek z jego pytań jest już `flagged` lub `archived`, bez przebudowy generatora i bez częściowo utworzonej sesji.

**Kontrakt:** Przy wstawianiu nowej sesji z `generation_batch_id` baza atomowo weryfikuje własność i status każdego z 40 pytań batcha, blokując ich równoległą zmianę do końca transakcji. Batch niekwalifikujący się zwraca kontrolowany `409`; brakujący lub uszkodzony mapping pozostaje `422`. Sesja rozpoczęta wcześniej nadal odczytuje swoje pytania.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Test serwisu i API potwierdza przejścia, osobne rozwiązanie po edycji, `401` bez sesji, `404` dla cudzego pytania i `409` dla niedozwolonego statusu.
- Test bazy potwierdza, że nowa sesja z pytaniem `flagged` lub `archived` nie powstaje, a `active` lub `verified` pozwala rozpocząć ją bez zmiany istniejącego payloadu batcha.
- `npm test`, `npm run lint` i `npm run build` przechodzą.

#### Weryfikacja ręczna

- Próba ponownego startu ze starym batchem po oznaczeniu pytania pokazuje błąd wymagający nowej generacji; już trwająca sesja nadal działa.

## Faza 3: Spójne odczyty i regresja

### Przegląd

Sprawdzić, że kolejka przeglądu, licznik i dokumentacja używają tego samego znaczenia statusu oraz że późniejsze S-02/S-04/S-05 mają stabilny kontrakt.

### Wymagane zmiany

#### 1. Odczyty oczekujących pytań

**Plik:** `src/pages/dashboard.astro`, `src/pages/api/stats/overview.ts`, `src/lib/services/questions.service.ts`, `src/components/dashboard/PendingReviewsWidget.astro`

**Cel:** Utrzymać spójność listy, licznika i linku do przyszłej zakładki po migracji danych. Nie traktować `archived` ani `verified` jako nierozwiązanych zgłoszeń.

**Kontrakt:** `/api/questions?status=flagged`, `flagged_questions_pending` i dashboard pokazują ten sam zbiór pytań właściciela. Filtr pozostaje stronicowany; licznik odpowiada pełnej liczbie, nie długości pierwszej strony.

#### 2. Kontrakt dla kolejnych fragmentów

**Plik:** `context/foundation/prd.md`, `context/changes/question-status-contract/plan-brief.md`

**Cel:** Zapisać świadomą zmianę decyzji względem US-03, gdzie wcześniej zapisano powrót do `active`, oraz udokumentować rozdział odpowiedzialności F-02/S-02/S-04/S-05.

**Kontrakt:** Po ręcznym rozwiązaniu pytanie ma `verified`; ręcznie dodane pytanie startuje jako `active`; archiwum wraca wyłącznie po jawnej akcji do `active`; zgłoszenie z podsumowania powstanie w S-02.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Testy potwierdzają zgodność licznika i paginowanej listy dla `flagged`, także gdy istnieją `verified`, `archived` i stare dane po migracji.
- `npm test`, `npm run lint` i `npm run build` przechodzą po wszystkich zmianach.

#### Weryfikacja ręczna

- Dashboard pokazuje zgłoszone pytanie dokładnie raz, a po rozwiązaniu znika ono z kolejki i licznika.
- Rozwiązanie bez poprawki oraz ręczne przywrócenie z archiwum mają jednoznaczny wynik w odczycie API.

## Strategia testowania

- Test SQL uruchamiany na odtwarzalnej lokalnej bazie w transakcji sprawdza migrację, trigger, własność danych, przejścia i blokadę sesji; nie wymaga danych produkcyjnych.
- Vitest sprawdza walidację i mapowanie błędów API oraz kontrakt statusów. Testy nie wywołują dostawcy AI.
- Ręczny smoke sprawdza dashboard, edycję/rozwiązanie przez API oraz sesję rozpoczętą przed i po fladze.

## Uwagi dotyczące wydajności

Kontrola startu sesji obejmuje dokładnie 40 identyfikatorów z batcha. Indeks `questions(user_id, status)` już istnieje (`supabase/migrations/20260321120000_questions_list_indexes.sql:24`); nie planujemy nowego indeksu bez pomiaru. Dashboard zachowuje obecne paginowanie.

## Uwagi dotyczące migracji

Migracja danych jest jednokierunkowa: `needs_review` staje się `flagged`, bez usuwania enumów i bez zmiany identyfikatorów pytań lub prób. W razie wycofania kodu stare odczyty `flagged` nadal widzą zgłoszenia; cofanie samego `UPDATE` nie jest potrzebne. Przed wdrożeniem należy policzyć wiersze obu statusów i zweryfikować wynik po migracji na kopii danych.

## Referencje

- `context/foundation/roadmap.md` — F-02 oraz zależne S-02, S-04, S-05.
- `context/foundation/prd.md` — US-02, US-03, FR-009, FR-015, FR-016 i ograniczenie bez zmian integracji AI.
- `supabase/migrations/20260301000000_baseline_schema.sql:129` — obecny trigger flagowania.
- `src/lib/services/questions.service.ts:311` — aktualny zapis statusu.
- `src/lib/services/sessions.service.ts:150` — tworzenie sesji z batcha.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Kanoniczny status i bezpieczny trigger

#### Automated

- [x] 1.1 Test SQL migracji aliasu i ochrony przed nowym `needs_review` — a104e29
- [x] 1.2 Test SQL przejść, znaczników czasu, ponownego flagowania i izolacji właściciela — a104e29

#### Manual

- [ ] 1.3 Kontrola liczby i widoczności historycznych pytań oraz prób po migracji

### Phase 2: API przejść i blokada ponownego startu batcha

#### Automated

- [x] 2.1 Test serwisu i API dla przejść, uwierzytelnienia i mapowania błędów — 46990a4
- [x] 2.2 Test bazy blokady nowej sesji dla wykluczonych pytań — 46990a4
- [x] 2.3 Uruchomić `npm test`, `npm run lint` i `npm run build` — 46990a4

#### Manual

- [ ] 2.4 Sprawdzić odmowę ponownego startu batcha i ciągłość sesji w toku

### Phase 3: Spójne odczyty i regresja

#### Automated

- [x] 3.1 Test zgodności licznika i paginowanej listy `flagged` — 1d1fec1
- [x] 3.2 Uruchomić `npm test`, `npm run lint` i `npm run build` — 1d1fec1

#### Manual

- [ ] 3.3 Sprawdzić kolejkę dashboardu po zgłoszeniu i rozwiązaniu
- [ ] 3.4 Sprawdzić rozwiązanie bez edycji i przywrócenie z archiwum
