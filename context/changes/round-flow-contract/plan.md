# Plan implementacji: round-flow-contract

## Cel

Domknąć minimalny backendowy kontrakt przepływu rundy, tak aby istniejący klient gry mógł utworzyć sesję z batcha, pobrać tylko bieżącą rundę, zapisać jedną próbę na pozycję, jawnie ukończyć rundę i odsłonić odpowiedzi dopiero po `round complete`. Ukończenie rundy 4 ma automatycznie zamykać sesję, ale bez uruchamiania jeszcze agregacji dashboardowych.

## Punkt wyjścia

- Frontend już zakłada brakujące endpointy: ładowanie rundy w `src/components/game/GameView.vue:180` i zapis próby w `src/components/game/QuizFocusMode.vue:50`.
- DTO dla rund, complete round i attempts są już ustalone w `src/types.ts:293`.
- `createSession()` tworzy sesję i oczekuje gotowych rekordów `rounds`, ale nie materializuje ich z `generation_batches.response_payload.rounds` w `src/lib/services/sessions.service.ts:104`.
- Generator zapisuje jedyny kanoniczny mapping batch -> round/question_ids do `response_payload` w `src/lib/services/generation-batch.service.ts:337`.
- Model danych i ograniczenia są już gotowe: `attempts`, `rounds`, `sessions`, unikalność pozycji oraz trigger porzucający stare sesje istnieją w `supabase/migrations/20260301000000_baseline_schema.sql:176`, `:352`, `:370`, `:484`, `:568`.

## Kluczowe decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Zakres fundamentu | Obejmuje `GET round`, `POST attempt`, `POST round complete` | `S-01` ma dostać gotowy reveal contract bez dopisywania semantyki stanu później | Plan |
| Źródło materializacji rund | `generation_batches.response_payload.rounds` | Batch już jest kanonicznym mappingiem pytań do rund | Plan |
| Duplikat próby | `409 Conflict` | Jest spójny z `uq_attempts_round_position` i prostym modelem zapisu | Plan |
| Dostęp do kolejnej rundy | Zablokowany do czasu `complete` poprzedniej | Wymusza flow produktu i eliminuje przeskakiwanie | Plan |
| Moment ustawiania `verdict` | Dopiero po `round complete` | Odpowiedzi mają być ujawniane dopiero po końcu rundy | Plan |
| Zamykanie sesji | Ostatni `round complete` automatycznie kończy sesję | Jeden atomowy kontrakt końca sesji | Plan |
| Analytics | Poza zakresem F-01 | Fundament przygotowuje dane źródłowe, nie denormalizację | Plan |

## Zakres

**W zakresie:**
- materializacja rekordów `rounds` podczas `createSession()`
- odczyt jednej rundy z maskowaniem `correct_answer` dla `in_progress`
- zapis attempts dla aktywnej rundy z walidacją ownership, pozycji i pytania
- jawne ukończenie rundy po komplecie prób oraz reveal odpowiedzi
- automatyczne przejście `sessions.status` do `completed` przy ukończeniu ostatniej rundy
- doprecyzowanie błędów HTTP i testów dla kontraktu

**Poza zakresem:**
- UI podsumowania rundy i samooceny
- `PATCH /api/attempts/:id` dla `verdict` i flagowania
- `category_stats_daily`, statystyki dashboardu i inne agregacje
- zmiany generatora AI, promptu lub dystrybucji pytań

## Architektura / Podejście

Warstwa `sessions.service` staje się właścicielem materializacji sesji z batcha: po walidacji batcha tworzy rekord `sessions`, wstawia 4 rekordy `rounds` według `response_payload.rounds`, a następnie zwraca `SessionCreatedDTO`. Nowa warstwa usług rund/attempts udostępni dwa kontrakty odczytu i dwa przejścia stanu: `getRoundByPosition()` pilnuje, że dostępna jest tylko bieżąca runda i maskuje odpowiedzi dla `in_progress`; `createAttempt()` zapisuje pojedynczą próbę tylko dla aktywnej rundy; `completeRound()` sprawdza komplet 10 prób, ustawia `rounds.status = completed`, odsłania odpowiedzi i przy rundzie 4 atomowo domyka sesję.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Materializacja sesji | `POST /api/sessions` tworzy realne `rounds` z batch payloadu | niespójny lub niepełny `response_payload` |
| 2. Contract rundy i prób | działające `GET round` i `POST attempt` z walidacją stanu | rozjazd między ownership sesji, rundy i question order |
| 3. Complete i finalizacja | `POST round complete` odsłania odpowiedzi i kończy sesję | nieatomowe przejścia stanu ostatniej rundy |

**Wymagania wstępne:** aktualne DTO w `src/types.ts` pozostają kanoniczne; brak migracji destrukcyjnych; RLS dla `sessions`, `rounds`, `attempts` pozostaje bez regresji.  
**Szacowany wysiłek:** ~2-3 sesje robocze w 3 fazach.

## Faza 1. Materializacja sesji z batcha

### Wymagane zmiany

- `src/lib/services/sessions.service.ts`  
  **Cel:** rozszerzyć `createSession()`, aby po utworzeniu rekordu sesji zmaterializował rekordy `rounds` z `generation_batches.response_payload.rounds` i zweryfikował integralność payloadu.  
  **Kontrakt:** payload musi zawierać 4 wpisy `position -> question_ids`; serwis odrzuca batch bez kompletnego `rounds` mappingu błędem 422/500 zależnie od klasy problemu.

- `src/pages/api/sessions/index.ts`  
  **Cel:** zachować obecny kontrakt wejścia/wyjścia, ale poprawnie mapować błędy materializacji rund.  
  **Kontrakt:** `POST /api/sessions` nadal zwraca `SessionCreatedDTO`, lecz nie może zwrócić sesji bez rekordów `rounds`.

### Kryteria sukcesu

#### Weryfikacja automatyczna:
- [ ] `POST /api/sessions` po `success` batchu zwraca 4 rekordy `rounds` uporządkowane po `position`
- [ ] próba utworzenia sesji z niekompletnym `response_payload.rounds` kończy się kontrolowanym błędem
- [ ] `npm run lint` przechodzi dla zmodyfikowanych plików

#### Weryfikacja ręczna:
- [ ] start gry po generacji nie wpada od razu na redirect z powodu braku rund
- [ ] nowa sesja pozostawia poprzednią `in_progress` jako `abandoned`, zgodnie z obecnym triggerem

## Faza 2. Odczyt rundy i zapis prób

### Wymagane zmiany

- `src/lib/services/rounds.service.ts`  
  **Cel:** dodać odczyt rundy po `sessionId + position` z walidacją ownership i blokadą dostępu do rundy `n+1` przed ukończeniem `n`.  
  **Kontrakt:** `RoundDTO.correct_answer` jest `null` dla `in_progress`, a odpowiedzi są odsłaniane dopiero po `completed`.

- `src/lib/services/attempts.service.ts`  
  **Cel:** dodać zapis pojedynczej próby tylko dla bieżącej aktywnej rundy oraz tylko dla pytania przypisanego do danej pozycji.  
  **Kontrakt:** `POST /api/rounds/:roundId/attempts` przy duplikacie pozycji zwraca `409`, przy złym stanie rundy `400`, przy obcym lub niepasującym pytaniu `404/400`.

- `src/pages/api/sessions/[sessionId]/rounds/[position].ts` i `src/pages/api/rounds/[roundId]/attempts.ts`  
  **Cel:** wystawić brakujące endpointy zgodnie z DTO i walidacją Zod.  
  **Kontrakt:** wejście ma być jawnie walidowane, a odpowiedzi muszą odpowiadać ustalonym typom z `src/types.ts`.

### Kryteria sukcesu

#### Weryfikacja automatyczna:
- [ ] `GET /api/sessions/:sessionId/rounds/1` zwraca pytania bieżącej rundy bez `correct_answer`
- [ ] `GET` dla kolejnej rundy przed ukończeniem poprzedniej kończy się błędem biznesowym, nie pustym 200
- [ ] `POST /api/rounds/:roundId/attempts` zapisuje jedną próbę i drugi zapis tej samej pozycji kończy się `409`
- [ ] `npm run lint` przechodzi dla nowych endpointów i serwisów

#### Weryfikacja ręczna:
- [ ] istniejący `GameView` może pobrać rundę 1 bez zmian kontraktu
- [ ] istniejący `QuizFocusMode` może zapisywać próby bez ujawniania odpowiedzi w trakcie rundy

## Faza 3. Complete round i finalizacja sesji

### Wymagane zmiany

- `src/lib/services/rounds.service.ts`  
  **Cel:** dodać `completeRound()` sprawdzające komplet prób, przełączające `rounds.status` na `completed` i zwracające reveal odpowiedzi.  
  **Kontrakt:** `complete` jest dozwolone tylko przy komplecie prób dla wszystkich pozycji rundy; ponowne `complete` zwraca `409`.

- `src/pages/api/sessions/[sessionId]/rounds/[roundId]/complete.ts`  
  **Cel:** wystawić jawny endpoint końca rundy.  
  **Kontrakt:** odpowiedź ma używać `CompleteRoundResponseDTO`; dla rundy 4 ta sama operacja kończy także `sessions.status = completed` i ustawia `completed_at`.

- `src/lib/services/sessions.service.ts` lub współdzielona transakcja RPC  
  **Cel:** zapewnić atomowość przejścia: `round complete` + opcjonalnie `session complete` dla ostatniej rundy.  
  **Kontrakt:** po sukcesie nie może istnieć stan, w którym runda 4 jest `completed`, a sesja nadal `in_progress`.

### Kryteria sukcesu

#### Weryfikacja automatyczna:
- [ ] `POST .../complete` przed zapisaniem 10 prób zwraca `400`
- [ ] `POST .../complete` po komplecie prób zwraca round payload z odsłoniętymi `correct_answer`
- [ ] `POST .../complete` dla rundy 4 ustawia `sessions.status = completed`
- [ ] `verdict` nadal pozostaje `null` po F-01; kontrakt nie miesza complete z self-assessment
- [ ] `npm run lint` przechodzi

#### Weryfikacja ręczna:
- [ ] backend odsłania odpowiedzi dopiero po jawnym końcu rundy
- [ ] po ukończeniu ostatniej rundy sesja jest gotowa pod późniejsze summary/statystyki bez dodatkowego endpointu

## Otwarte ryzyka i założenia

- Zakładam, że `response_payload.rounds` jest jedynym trwałym źródłem kolejności pytań; jeśli istnieją historyczne batch’e bez tego pola, trzeba je traktować jako nieobsługiwane dla nowych sesji.
- Atomowość finalizacji może wymagać RPC lub ostrożnej sekwencji update’ów, jeśli klient Supabase nie daje wystarczająco bezpiecznej transakcji aplikacyjnej.
- Obecny klient gry nie wywołuje jeszcze `complete round`; `S-01` będzie pierwszym konsumentem pełnego reveal contractu.

## Kryteria sukcesu (podsumowanie)

- Fundament dostarcza pełny backendowy kontrakt: sesja tworzy rundy, gra pobiera tylko bieżącą rundę, próby zapisują się pojedynczo, a reveal następuje dopiero po `complete`.
- Stan końcowy jest spójny: ukończenie rundy 4 automatycznie kończy sesję, ale bez wdrażania jeszcze samooceny i analytics.
- Zmiana nie narusza istniejących DTO, RLS ani generatora batchy; dodaje brakujące semantyki zamiast przepisywać obecny flow.

## Progress

### Phase 1: Materializacja sesji z batcha

#### Automated
- [x] 1.1 Rozszerzyć `createSession()` o odczyt i walidację `generation_batches.response_payload.rounds` — 9f63ef6
- [x] 1.2 Materializować rekordy `rounds` przy tworzeniu sesji i zwracać je w `SessionCreatedDTO` — 9f63ef6
- [x] 1.3 Zmapować błędy materializacji w `POST /api/sessions` — 9f63ef6
- [x] 1.4 Uruchomić `npm run lint` — 9f63ef6

#### Manual
- [x] 1.5 Potwierdzić, że start gry po generacji nie kończy się redirectem z powodu braku rund — 9f63ef6
- [x] 1.6 Potwierdzić, że nowa sesja pozostawia poprzednią `in_progress` jako `abandoned` — 9f63ef6

### Phase 2: Odczyt rundy i zapis prób

#### Automated
- [x] 2.1 Dodać serwis odczytu rundy z blokadą dostępu do rundy `n+1` przed ukończeniem `n` — 5f731d5
- [x] 2.2 Dodać serwis zapisu próby z walidacją ownership, pozycji i pytania — 5f731d5
- [x] 2.3 Wystawić `GET /api/sessions/:sessionId/rounds/:position` i `POST /api/rounds/:roundId/attempts` — 5f731d5
- [x] 2.4 Zweryfikować, że duplikat próby zwraca `409`, a `correct_answer` pozostaje ukryte dla `in_progress` — 5f731d5
- [x] 2.5 Uruchomić `npm run lint` — 5f731d5

#### Manual
- [x] 2.6 Potwierdzić, że istniejący `GameView` pobiera rundę 1 bez zmiany kontraktu
- [x] 2.7 Potwierdzić, że `QuizFocusMode` zapisuje próby bez ujawniania odpowiedzi w trakcie rundy

### Phase 3: Complete round i finalizacja sesji

#### Automated
- [x] 3.1 Dodać `completeRound()` z walidacją kompletu prób i ochroną przed ponownym `complete`
- [x] 3.2 Wystawić `POST /api/sessions/:sessionId/rounds/:roundId/complete`
- [x] 3.3 Domknąć automatyczne `sessions.status = completed` dla rundy 4
- [x] 3.4 Zweryfikować, że `complete` odsłania odpowiedzi, ale nie ustawia jeszcze `verdict`
- [x] 3.5 Uruchomić `npm run lint`

#### Manual
- [x] 3.6 Potwierdzić, że backend odsłania odpowiedzi dopiero po jawnym końcu rundy
- [x] 3.7 Potwierdzić, że po ukończeniu ostatniej rundy sesja jest gotowa pod późniejsze summary/statystyki


