# Fundament testów i kontrola generowania — plan implementacji

## Przegląd

Phase 1 rollout planu testów ustanawia pierwszą deterministyczną bazę testową projektu i jednocześnie domyka produkcyjny kontrakt generowania pytań. Zmiana ma udowodnić bez płatnych wywołań, że synchroniczny batch 40 pytań kończy pracę w granicy 40 sekund, nie przekracza sześciu prób providera ani preflightowego limitu 0,02 USD, jest idempotentny i pozostawia prawdziwy stan terminalny wraz z zagregowaną telemetrią.

## Analiza stanu obecnego

- Projekt nie ma runnera, skryptu `test`, konfiguracji ani plików testowych; istniejące bramy to `npm run lint` oraz `npm run build` (`package.json:5-16,45-64`).
- UI zleca 40 pytań jako cztery chunki po 10, ale API przyjmuje dowolny model i do 200 pytań (`src/components/game/GameView.vue:59-66`, `src/pages/api/generation-batches/index.ts:18-23`).
- `MAX_RETRIES = 2` działa osobno dla każdego chunku, więc zwykły batch może wykonać 12, a maksymalny request 60 wywołań providera (`src/lib/services/generation-batch.service.ts:21-27,190-237,385-418`).
- Timeout OpenAI wynosi 60 sekund na pojedynczą próbę. Brakuje deadline'u batcha i propagowanego `AbortSignal` (`src/lib/openai.client.ts:9,25-34,65-81`).
- Koszt jest wyliczany dopiero po udanej odpowiedzi, nieznany model daje `null`, a koszt płatnych odpowiedzi odrzuconych później przez walidację nie trafia do sumy (`src/lib/openai.client.ts:17-21,43-62,93-96`; `src/lib/services/generation-batch.service.ts:209-237,405-418`).
- Finalizacja sukcesu nie zapisuje retry, finalizacja porażki zawsze zapisuje `2`, a błędy zapisu terminalnego są logowane i połykane (`src/lib/services/generation-batch.service.ts:142-177,419-455`).
- `generation_batches` przechowuje tylko `retry_count`, koszt nullable i status, bez liczby prób, tokenów, failure code ani idempotency key (`supabase/migrations/20260301000000_baseline_schema.sql:250-272`).
- Timeout UI działa wyłącznie podczas pollingu odpowiedzi `201`; bieżący synchroniczny POST zwraca `202` dopiero po wykonaniu całej pracy i nie jest anulowalny (`src/components/game/GameView.vue:97-105,209-247,262-270`).
- Auth w endpointcie generowania jest wyłączony i zastąpiony stałym użytkownikiem testowym (`src/pages/api/generation-batches/index.ts:29-40`).

## Pożądany stan końcowy

Każdy zaakceptowany request pochodzi od zalogowanego użytkownika, używa `gpt-6-luna` i promptu `v1`, ma unikalny klucz idempotencji oraz podlega jednej polityce batcha. Przed pierwszym wywołaniem system odrzuca żądanie, którego konserwatywny koszt przekroczyłby 0,02 USD. Podczas wykonania wspólny deadline, budżet dwóch retry i limit sześciu prób obejmują wszystkie chunki, backoffy i wywołania providera.

Testy Vitest działają w Node z fake providerem, zegarem i kontrolowaną granicą persistencji. Udowadniają abort aktywnej próby, brak kolejnych chunków po deadline lub wyczerpaniu budżetu, klasyfikację retry, rozliczenie obserwowalnych tokenów/kosztu oraz terminalną finalizację. Produkcyjne wywołanie może zakończyć się sukcesem albo kontrolowanym `failed`; nie może zwrócić fałszywego `202`, gdy zapis terminalny się nie udał.

### Kluczowe odkrycia

- Najwyższy sygnał daje test czystego orkiestratora, nie test UI ani pgTAP (`context/changes/testing-generation-guardrails/research.md`, sekcja „Existing test surface and cheapest useful layer”).
- `getViteConfig()` pozwala zachować konfigurację Astro i alias `@`, a środowisko `node` nie wymaga jsdom ani Vue Test Utils.
- Adapter OpenAI musi przyjąć `AbortSignal`, pozostały timeout i limit outputu; testowany core nie może runtime-importować `astro:env/server`.
- Unikalność idempotency key i jednego `pending` na użytkownika musi być wymuszona w bazie, ponieważ aplikacyjny check nie chroni przed równoległym insertem.

## Kluczowe decyzje

| Decyzja                 | Wybór                                                | Dlaczego                                                                     | Źródło  |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| Architektura odpowiedzi | Zachować synchroniczny pełny batch                   | Progressive first-round wymaga osobnej architektury background/partial state | Plan    |
| Deadline                | 40 sekund na batch                                   | Ogranicza czas i wydatki zgodnie z guardrailem produktu                      | Plan    |
| Budżet prób             | 6 prób łącznie, w tym maksymalnie 2 retry            | Cztery chunki mają cztery próby bazowe bez mnożenia retry per chunk          | Plan    |
| Budżet odpowiedzi       | 4096 output tokens na próbę                          | Jest konserwatywny dla 10 pytań i zmniejsza worst-case spend                 | Plan    |
| Budżet kosztu           | 0,02 USD preflight na batch                          | Daje jawny fail-closed ceiling przed wydaniem środków                        | Plan    |
| Model i prompt          | Tylko `gpt-6-luna` + `v1`                            | To jedyny aktualny klient i najwęższy przewidywalny katalog                  | Plan    |
| Powtórzenia requestu    | Idempotency key + jeden aktywny batch na użytkownika | Chroni transport retry, double-submit i dwa równoległe okna                  | Plan    |
| Telemetria              | Agregaty batcha, bez per-attempt ledger              | Wystarcza do dowodu guardraili bez nowej tabeli zdarzeń                      | Plan    |
| Anulowanie              | Propagowany abort, terminal `client_cancelled`       | Cancel/retry/unmount muszą zatrzymać kolejne wydatki                         | Plan    |
| Auth                    | `401` przed admission dla anonima                    | Budżet i idempotencja wymagają rzeczywistej tożsamości użytkownika           | Plan    |
| Warstwa testowa         | Vitest Node, fake provider/clock/persistence         | Najtańszy deterministyczny sygnał, bez płatnego OpenAI                       | Badania |

## Czego NIE robimy

- Nie budujemy kolejki, workera, streamingu ani częściowego udostępniania pierwszej rundy.
- Nie dodajemy limitu USD per użytkownik/godzina ani nie konfigurujemy providerowego hard-spend capu.
- Nie tworzymy pełnego ledgeru per attempt ani nie zapisujemy provider response IDs.
- Nie dodajemy jsdom, Vue Test Utils, Playwrighta, coverage threshold ani szerokich snapshotów.
- Nie uruchamiamy płatnych smoke testów OpenAI.
- Nie dodajemy pgTAP/RLS — to zakres rollout Phase 3.
- Nie zapewniamy atomowej transakcji obejmującej pytania, kategorie i finalizację batcha; błąd finalizacji ma być widoczny, a nie maskowany.
- Nie przebudowujemy globalnego rate limitu 100 batchy/godzinę poza tym, co jest konieczne do jednego aktywnego batcha i idempotentnego admission.

## Podejście do implementacji

Logika zostanie podzielona na cztery granice: czysta polityka admission, wstrzykiwalny orkiestrator, adapter providera i repozytorium lifecycle'u batcha. Orkiestrator otrzymuje provider, zegar/sleep oraz politykę jako zależności; dzięki temu testy sterują czasem i odpowiedziami bez importu sekretów lub sieci. `generation-batch.service.ts` pozostaje composition/lifecycle layerem integrującym orkiestrator z Supabase, deduplikacją pytań i dystrybucją rund.

Admission najpierw rozwiązuje idempotency key i istniejący aktywny batch, potem waliduje allowlistę i konserwatywny worst-case budget, a dopiero na końcu tworzy `pending`. Migracja dodaje agregaty telemetryczne oraz dwa niezależne zabezpieczenia konkurencji: unikalny `(user_id, idempotency_key)` dla niepustych kluczy i maksymalnie jeden rekord `pending` na użytkownika.

## Krytyczne szczegóły implementacji

**Czas i cykl życia:** Deadline 40 sekund powstaje raz na granicy batcha. Ten sam absolutny deadline ogranicza request providera i abortowalne backoffy; przed każdą próbą/chunkiem sprawdzany jest pozostały czas. Po przekroczeniu deadline'u aktywny signal jest anulowany, nie startuje kolejna próba, a system natychmiast próbuje utrwalić `failed`.

**Sekwencjonowanie stanu:** Tylko warunkowa zmiana z `pending` może ustanowić stan terminalny — pierwszy trwały `success` albo `failed` wygrywa. Błąd zapisu terminalnego jest propagowany i nie może skutkować `202`; późniejsze admission odzyskuje `pending` starsze niż 60 sekund jako `stale_pending`.

**Rachunkowość:** `estimated_cost_usd` oznacza koszt zaobserwowany z usage zwróconego przez provider, także gdy poprawnie rozliczona odpowiedź odpada później na walidacji liczby pytań. Preflight ceiling jest osobnym konserwatywnym maksimum zapisanym wraz ze snapshotem polityki w `request_payload`; lokalny abort nie jest dowodem zatrzymania provider-side billing.

## Faza 1: Fundament Vitest i polityka admission

### Przegląd

Uruchomić najmniejszy runner Node i zdefiniować czystą, współdzieloną politykę modelu, promptu oraz budżetów. Pierwsze testy mają dowodzić fail-closed admission bez importu OpenAI, Supabase lub DOM.

### Wymagane zmiany

#### 1. Runner i skrypty

**Pliki:** `package.json`, `package-lock.json`, `vitest.config.ts`

**Cel:** Dodać jedną devDependency `vitest`, skrypty `test`/`test:watch` oraz Astro-aware konfigurację uruchamianą w środowisku Node.

**Kontrakt:** `vitest.config.ts` używa `getViteConfig()`, obejmuje `src/**/*.test.ts`, nie włącza globals, jsdom, setup files ani coverage. Testy jawnie importują API z `vitest`.

#### 2. Kanoniczna polityka generowania

**Plik:** `src/lib/services/generation-policy.ts`

**Cel:** Skupić allowlistę i wszystkie limity w jednym module używanym przez API, orkiestrator i testy, aby wartości nie rozjeżdżały się między warstwami.

**Kontrakt:** Polityka dopuszcza `provider=openai`, `model=gpt-6-luna`, `prompt_version=v1`, dokładnie 40 pytań, chunki po 10, maksymalnie 6 prób/2 retry, 4096 output tokens na próbę, deadline 40 000 ms i preflight ceiling 0,02 USD. Nieznany model/cena lub przekroczony worst-case budget kończy admission przed provider call.

#### 3. Błędy domenowe guardraili

**Plik:** `src/lib/errors.ts`

**Cel:** Oddzielić trwałe błędy admission, deadline, anulowanie, wyczerpanie budżetu i persistencji od parse/provider failures.

**Kontrakt:** Każda klasa błędu ma stabilny machine-readable code używany przez persistence i mapowanie HTTP; nie zawiera sekretów ani surowej odpowiedzi providera.

#### 4. Testy polityki

**Plik:** `src/lib/services/generation-policy.test.ts`

**Cel:** Udowodnić allowlistę i arytmetykę worst-case budget jako czysty kontrakt.

**Kontrakt:** Testy obejmują poprawny request 40 pytań, nieznany model/prompt/count, brak ceny oraz przekroczenie call/token/USD ceiling; odrzucone przypadki nie mają dostępu do providera.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Vitest Node uruchamia współlokowane testy przez `npm test` bez jsdom i prawdziwych sekretów.
- Polityka admission testuje allowlistę oraz limity 6 prób, 4096 tokenów, 40 sekund i 0,02 USD.
- `npm run lint` oraz `npm run build` przechodzą po dodaniu konfiguracji i typów testowych.

#### Weryfikacja ręczna

- Przegląd import graph potwierdza, że test polityki nie może załadować klienta OpenAI ani wykonać połączenia sieciowego.

**Uwaga implementacyjna:** Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie izolacji od sieci przed rozpoczęciem Fazy 2.

---

## Faza 2: Guardraile wykonania i provider seam

### Przegląd

Wydzielić deterministyczny orkiestrator całego batcha i rozpocząć od failure-first testu never-settling providera. Następnie domknąć deadline, wspólny budżet prób, retry classification, abortowalny backoff i rachunkowość usage.

### Wymagane zmiany

#### 1. Wstrzykiwalny orkiestrator

**Plik:** `src/lib/services/generation-orchestrator.ts`

**Cel:** Oddzielić wykonanie AI od Supabase, routingu i singletonu OpenAI, zachowując jeden batch-scoped kontrakt dla wszystkich chunków.

**Kontrakt:** Orkiestrator przyjmuje provider port, clock/sleep, absolutny deadline i politykę. Zwraca pytania oraz agregat `attemptCount`, `retryCount`, input/output tokens i observed cost albo rzuca typowany błąd z takim samym częściowym agregatem.

#### 2. Adapter OpenAI

**Plik:** `src/lib/openai.client.ts`

**Cel:** Uczynić obecny klient cienkim adapterem respektującym pozostały czas i limit odpowiedzi, bez wewnętrznych SDK retry.

**Kontrakt:** Wywołanie przyjmuje `AbortSignal`, timeout nie większy niż pozostały deadline oraz `maxOutputTokens=4096`; zwraca znormalizowane usage i koszt dla `gpt-6-luna`. Brak lub nieznana cena jest błędem admission, nie `null` po wydaniu środków.

#### 3. Retry i globalny budżet

**Plik:** `src/lib/services/generation-orchestrator.ts`

**Cel:** Zastąpić retry per chunk jednym budżetem dwóch retry i sześciu prób dla całego batcha.

**Kontrakt:** Retryable są 429/5xx oraz odpowiedź strukturalnie niepoprawna lub o złej liczbie pytań; trwałe 4xx nie są ponawiane. Próba i jej obserwowalne usage są rozliczane przed decyzją o retry. Abort/deadline nie uruchamia retry ani kolejnego chunku.

#### 4. Testy kontraktu wykonania

**Plik:** `src/lib/services/generation-orchestrator.test.ts`

**Cel:** Udowodnić Risk #1 fake providerem i fake timers, rozpoczynając od providera, który nigdy nie kończy.

**Kontrakt:** Scenariusze obejmują never-settling abort, dokładnie cztery wywołania happy path, globalne maksimum sześciu prób, dwa retry 429/5xx, jedno wywołanie dla trwałego 4xx, brak kolejnych chunków po deadline/budget oraz doliczenie usage płatnej odpowiedzi odrzuconej przez wrong-count validation.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Never-settling provider jest anulowany przed 40 sekundami, batch kończy się błędem deadline i nie startuje kolejnego chunku.
- Testy potwierdzają maksymalnie 6 prób i 2 retry łącznie oraz brak retry dla trwałego 4xx.
- Testy agregują usage/koszt także dla odpowiedzi wrong-count i odróżniają observed cost od preflight ceiling.
- `npm test`, `npm run lint` i `npm run build` przechodzą bez sieci i realnego oczekiwania na timeout/backoff.

#### Weryfikacja ręczna

- Log fake providera potwierdza przekazanie tego samego sygnału anulowania oraz malejącego pozostałego czasu do kolejnych prób.

**Uwaga implementacyjna:** Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie kontraktu czasu i prób przed podłączeniem persistencji.

---

## Faza 3: Idempotentny i trwały lifecycle batcha

### Przegląd

Rozszerzyć schemat i warstwę service/repository, aby admission był odporny na konkurencję, a terminalny zapis wiernie przechowywał wynik orkiestratora. Ta faza nie zmienia jeszcze publicznego UI.

### Wymagane zmiany

#### 1. Migracja guardraili

**Plik:** `supabase/migrations/20260926160000_generation_batch_guardrails.sql`

**Cel:** Dodać minimalną telemetrię i constrainty wymagane przez idempotencję oraz jeden aktywny batch.

**Kontrakt:** Dodać nullable `idempotency_key` dla zgodności z legacy, nieujemne `provider_attempt_count`, `input_tokens`, `output_tokens` i nullable `failure_code`; `retry_count` oznacza łączny retry batcha i zachowuje zakres 0–2. Utworzyć partial unique index `(user_id, idempotency_key)` dla wartości non-null oraz partial unique index na `user_id` dla `status='pending'`. Przed drugim indeksem deterministycznie oznaczyć starsze duplikaty `pending` jako `failed/superseded_legacy_pending`, zachowując najnowszy rekord użytkownika.

#### 2. Wygenerowane typy i DTO

**Pliki:** `src/db/database.types.ts`, `src/types.ts`

**Cel:** Przenieść nowe pola do kanonicznych typów DB i bezpiecznych DTO; usunąć przy okazji zduplikowaną deklarację `ListGenerationBatchesResponseDTO`.

**Kontrakt:** DTO status/list/success eksponują zagregowane attempts, retry, tokeny, observed cost i failure code bez `request_payload`; command zawęża provider/model/prompt/count do polityki Phase 1.

#### 3. Admission i odzyskiwanie duplikatu

**Plik:** `src/lib/services/generation-batch.service.ts`

**Cel:** Rozwiązać idempotencję i jeden aktywny batch atomowo przed wydaniem budżetu providera.

**Kontrakt:** Ten sam key i kanoniczny payload odtwarza istniejący pending/success; ten sam key z innym payloadem zwraca conflict. Inny key przy aktywnym równoważnym batchu zwraca istniejący pending zamiast rozpoczynać drugie generowanie. `pending` starszy niż 60 sekund jest warunkowo domykany jako `stale_pending` przed ponownym admission. Unique violations są oczekiwanym rozstrzygnięciem race, nie błędem 500.

#### 4. Terminalna persistencja

**Plik:** `src/lib/services/generation-batch.service.ts`

**Cel:** Zapisywać prawdziwe agregaty dla sukcesu i każdej porażki oraz przestać połykać błędy finalizacji.

**Kontrakt:** Finalizacja wykonuje warunkowy update `status='pending'` do jednego terminalnego stanu, zapisuje attempts/retries/tokens/cost/failure code/finished_at i sprawdza wynik. Brak potwierdzonego zapisu nie może zwrócić sukcesu; błąd persistence jest propagowany z pierwotną przyczyną. Pytania i rundy są zwracane dopiero po potwierdzonym `success`.

#### 5. Testy lifecycle'u

**Plik:** `src/lib/services/generation-batch.service.test.ts`

**Cel:** Zweryfikować integrację orkiestratora z kontrolowaną granicą persistencji i zachowanie w race/finalization failure.

**Kontrakt:** Testy obejmują replay tego samego key, conflict zmienionego payloadu, drugi równoległy start, stale pending recovery, sukces i porażkę z pełną telemetrią, later-chunk failure po wcześniejszym koszcie oraz błąd finalizacji bez fałszywego sukcesu.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npx supabase db reset` stosuje migrację, constrainty telemetrii oraz oba partial unique indexes bez błędów.
- Typy i testy potwierdzają idempotentny replay, jeden `pending` na użytkownika i kontrolowany stale recovery.
- Sukces i każda porażka zapisują prawdziwe agregaty, a błąd finalizacji nie zwraca sukcesu.
- `npm test`, `npm run lint` i `npm run build` przechodzą po integracji service/persistence.

#### Weryfikacja ręczna

- Inspekcja lokalnej bazy potwierdza, że terminalny rekord zawiera attempts, retry, tokeny, observed cost i stabilny failure code.

**Uwaga implementacyjna:** Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie danych terminalnych przed zmianą publicznego endpointu.

---

## Faza 4: Auth, API, anulowanie klienta i cookbook

### Przegląd

Podłączyć guardraile do publicznej trasy i klienta gry, przywrócić auth oraz zakończyć rollout dokumentacją wzorca testowego. UI zachowuje synchroniczny model sukcesu, ale potrafi odzyskać istniejący pending i zatrzymać aktywny request.

### Wymagane zmiany

#### 1. Kontrakt POST generation batches

**Plik:** `src/pages/api/generation-batches/index.ts`

**Cel:** Egzekwować auth, kanoniczną politykę i idempotency key przed wywołaniem service.

**Kontrakt:** Anonim otrzymuje `401` przed insertem/providerem. Trasa wymaga poprawnego `Idempotency-Key`, zawęża body do `gpt-6-luna/openai/v1/40`, przekazuje `request.signal`, zwraca `201` dla istniejącego `pending`, `202` dla potwierdzonego sukcesu i stabilne kody błędów dla conflict, budget, deadline/cancel, provider oraz persistence failure.

#### 2. Anulowalny klient gry

**Pliki:** `src/lib/generation-request.client.ts`, `src/components/game/GameView.vue`

**Cel:** Zatrzymać aktywny POST na cancel, retry i unmount oraz zarządzać kluczem idempotencji zgodnie z lifecycle'em użytkownika.

**Kontrakt:** Czysty helper klienta przyjmuje `fetch`, timer i generator klucza jako zależności, dzięki czemu jego lifecycle jest testowalny w Node bez jsdom. Jeden start tworzy jeden key; transport replay zachowuje key, jawny retry po terminalnej porażce tworzy nowy. `AbortController` jest przechowywany dla aktywnego POST, anulowany na cancel/retry/unmount i chroniony transportowym limitem nieznacznie większym od serwerowych 40 sekund. `201` przechodzi do istniejącego pollingu, `202` tworzy sesję.

#### 3. Komunikaty błędów

**Pliki:** `src/components/game/GenerationLoadingScreen.vue`, `src/components/game/GenerationErrorMessage.vue`

**Cel:** Rozróżnić deadline/budget/conflict od ogólnego upstream error bez ujawniania szczegółów technicznych.

**Kontrakt:** Typ błędu ma jedno współdzielone źródło lub identyczny union w obu komponentach; cancel nawigujący do dashboardu nie pokazuje błędu, a retry jest dostępny tylko dla terminalnych porażek i tworzy nowy key.

#### 4. Testy granicy API

**Pliki:** `src/pages/api/generation-batches/index.test.ts`, `src/lib/generation-request.client.test.ts`

**Cel:** Udowodnić, że auth i walidacja zatrzymują żądanie przed service/providerem oraz że typowane błędy mają stabilne statusy HTTP.

**Kontrakt:** Testy API obejmują anonimowe `401`, brak/zły idempotency key, zły model/count, pending replay `201`, success `202`, conflict, deadline, budget i persistence error. Test helpera klienta obejmuje reuse/new idempotency key oraz abort aktywnego requestu na timeout, cancel, retry i dispose/unmount; wszystkie przypadki używają stubów bez sieci.

#### 5. Dokumentacja rollout Phase 1

**Plik:** `context/foundation/test-plan.md`

**Cel:** Po ukończeniu implementacji zastąpić TBD w §6.1 rzeczywistym failure-first patternem i dopisać krótką notę per-phase.

**Kontrakt:** Cookbook opisuje fake provider + fake timers + kontrolowaną persistencję, wymienia wymagane scenariusze i przypomina, że timeout, liczba wywołań i koszt są osobnymi asercjami. Status Phase 1 przechodzi z `planned` przez `implementing` do `complete` zgodnie z orchestracją.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Test API potwierdza `401` i odrzucenie błędnego admission przed service/providerem.
- Testy klienta/kontraktu potwierdzają idempotency key, pending replay oraz abort na deadline/cancel/retry/unmount bez płatnych wywołań.
- Mapowanie HTTP rozróżnia conflict, budget, deadline/cancel, provider, parse i persistence failure.
- Pełne `npm test`, `npm run lint` i `npm run build` przechodzą, a §6.1 `test-plan.md` opisuje dostarczony wzorzec.

#### Weryfikacja ręczna

- Zalogowany użytkownik uruchamia generowanie, otrzymuje quiz przy sukcesie, a dwa szybkie starty nie tworzą dwóch batchy ani podwójnego wydatku.
- Cancel i jawny retry zatrzymują poprzedni request, zapisują właściwy failure code i nie uruchamiają późniejszych chunków.

**Uwaga implementacyjna:** Po pełnych bramach zatrzymaj się na ręczny smoke z fake/stub providerem; płatny smoke OpenAI pozostaje poza zakresem.

## Strategia testowania

### Testy jednostkowe i kontraktowe

- Polityka admission: allowlista, count, call/output/USD ceiling i fail-closed pricing.
- Orkiestrator: fake provider, fake clock, abortowalny sleep, dokładne próby i częściowa telemetria błędu.
- Klasyfikacja błędów: retryable 429/5xx/invalid payload, non-retryable 4xx, deadline, cancel i budget exhaustion.
- Rachunkowość: koszt i tokeny każdej obserwowalnej odpowiedzi przed walidacją biznesową.

### Testy integracyjne service/API

- Lifecycle z kontrolowanym repozytorium: pending, success, failed, finalization failure i stale recovery.
- Idempotency i konkurencja: ten sam key/payload, key reuse z innym payloadem oraz drugi aktywny start.
- API: auth i admission przed service, statusy 201/202/4xx/5xx oraz propagacja request signal.
- Migracja: lokalny reset potwierdzający kolumny, constraints i partial unique indexes.

### Kroki testowania ręcznego

1. Zalogować się i uruchomić generowanie z fake/stub providerem kończącym cztery chunki sukcesem.
2. Uruchomić równoległy start w drugiej karcie i potwierdzić reuse istniejącego pending zamiast nowego batcha.
3. Anulować generowanie podczas pierwszego wywołania i potwierdzić terminal `client_cancelled` oraz brak kolejnego chunku.
4. Uruchomić jawny retry i potwierdzić nowy idempotency key oraz brak wznowienia starego batcha.
5. Zasymulować przekroczenie 40 sekund i finalization failure; UI nie może rozpocząć sesji ani pokazać fałszywego sukcesu.

## Uwagi dotyczące wydajności

- Guardraile zmniejszają maksymalną liczbę wywołań z 12 do 6 dla zwykłego batcha i usuwają ścieżkę 200 pytań/60 prób.
- Testy czasu używają fake timers; żaden przypadek nie czeka realnych 40 sekund ani backoffu.
- Dwa partial unique indexes są małe i selektywne. Lookup idempotency wykorzystuje `(user_id, idempotency_key)`, a tylko rekordy `pending` uczestniczą w indeksie aktywnego batcha.
- Dodatkowe update'y telemetryczne następują wyłącznie przy terminalizacji; nie zapisujemy wiersza per attempt.

## Uwagi dotyczące migracji

- Nowe pola mają bezpieczne wartości domyślne dla istniejących rekordów; legacy `idempotency_key` pozostaje nullable.
- Przed utworzeniem unique index jednego `pending` migracja zachowuje najnowszy pending każdego użytkownika, a starsze domyka z jawnym failure code.
- Wygenerowane `src/db/database.types.ts` musi odpowiadać schematowi po migracji; ręczna edycja bez zgodności z bazą jest niedopuszczalna.
- Rollback wymaga najpierw usunięcia obu indeksów, następnie nowych constraints/kolumn; nie przywraca automatycznie batchy oznaczonych jako `superseded_legacy_pending`.

## Referencje

- Strategia rollout: `context/foundation/test-plan.md`
- Badania Phase 1: `context/changes/testing-generation-guardrails/research.md`
- Tożsamość zmiany: `context/changes/testing-generation-guardrails/change.md`
- Obecny orkiestrator: `src/lib/services/generation-batch.service.ts:21-27,142-237,385-456`
- Adapter providera: `src/lib/openai.client.ts:9-106`
- Trasa API: `src/pages/api/generation-batches/index.ts:18-110`
- Klient gry: `src/components/game/GameView.vue:59-66,97-105,209-270,307-319`
- Schemat batcha: `supabase/migrations/20260301000000_baseline_schema.sql:250-272`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fundament Vitest i polityka admission

#### Automated

- [x] 1.1 Uruchomić Vitest Node dla współlokowanych testów bez jsdom i prawdziwych sekretów — 2faa14e
- [x] 1.2 Udowodnić allowlistę i limity admission 6 prób, 4096 tokenów, 40 sekund i 0,02 USD — 2faa14e
- [x] 1.3 Uruchomić lint i build po dodaniu konfiguracji oraz typów testowych — 2faa14e

#### Manual

- [ ] 1.4 Potwierdzić, że test polityki nie ładuje OpenAI ani nie wykonuje połączenia sieciowego

### Phase 2: Guardraile wykonania i provider seam

#### Automated

- [x] 2.1 Anulować never-settling provider przed deadlinem bez uruchomienia kolejnego chunku — 1654e81
- [x] 2.2 Egzekwować maksymalnie 6 prób i 2 retry łącznie bez retry trwałego 4xx — 1654e81
- [x] 2.3 Agregować usage i koszt odpowiedzi odrzuconych po walidacji biznesowej — 1654e81
- [x] 2.4 Uruchomić pełne testy, lint i build bez sieci oraz realnych timeoutów — 1654e81

#### Manual

- [ ] 2.5 Potwierdzić wspólny AbortSignal i malejący pozostały czas w logu fake providera

### Phase 3: Idempotentny i trwały lifecycle batcha

#### Automated

- [x] 3.1 Zastosować migrację guardraili i oba partial unique indexes przez lokalny reset bazy
- [x] 3.2 Udowodnić idempotentny replay, jeden pending na użytkownika i stale recovery
- [x] 3.3 Zapisać prawdziwe agregaty terminalne bez fałszywego sukcesu przy błędzie finalizacji
- [x] 3.4 Uruchomić pełne testy, lint i build po integracji service oraz persistencji

#### Manual

- [ ] 3.5 Potwierdzić komplet attempts, retry, tokenów, kosztu i failure code w lokalnej bazie

### Phase 4: Auth, API, anulowanie klienta i cookbook

#### Automated

- [ ] 4.1 Odrzucić anonimowe i błędne admission przed service oraz providerem
- [ ] 4.2 Udowodnić idempotency key, pending replay i abort klienta bez płatnych wywołań
- [ ] 4.3 Rozróżnić mapowanie conflict, budget, deadline, cancel, provider, parse i persistence failure
- [ ] 4.4 Uruchomić pełne bramy i opisać dostarczony wzorzec w test-plan cookbook

#### Manual

- [ ] 4.5 Potwierdzić zalogowany sukces i brak podwójnego batcha przy dwóch szybkich startach
- [ ] 4.6 Potwierdzić, że cancel i retry zatrzymują poprzednią pracę oraz zapisują właściwy failure code
