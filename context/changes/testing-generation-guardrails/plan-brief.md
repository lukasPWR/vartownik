# Fundament testów i kontrola generowania — krótki plan

> Pełny plan: `context/changes/testing-generation-guardrails/plan.md`
> Badania: `context/changes/testing-generation-guardrails/research.md`

## Co i dlaczego

Phase 1 uruchamia pierwszą bazę testową projektu i zabezpiecza generowanie pytań przed nieograniczonym czasem, retry i kosztem. Dzisiejszy timeout dotyczy pojedynczej próby, więc zwykły batch może wykonać 12 wywołań i trwać wiele minut; plan zastępuje to jednym kontraktem całego batcha sprawdzanym offline.

## Punkt wyjścia

Projekt nie ma runnera ani testów. Generowanie dzieli 40 pytań na cztery sekwencyjne chunki, mnoży dwa retry przez każdy chunk, nie propaguje anulowania i zapisuje niepełną telemetrię kosztu oraz prób. API dodatkowo dopuszcza dowolny model i do 200 pytań, a auth POST jest tymczasowo wyłączony.

## Pożądany stan końcowy

Zalogowany użytkownik uruchamia jeden idempotentny batch 40 pytań. Cała praca podlega deadline'owi 40 sekund, limitowi sześciu prób, 4096 output tokens na próbę i preflightowemu ceiling 0,02 USD; anulowanie zatrzymuje aktywną pracę, a wynik terminalny przechowuje prawdziwe agregaty prób, tokenów i obserwowalnego kosztu.

Vitest udowadnia te właściwości fake providerem, zegarem i persistencją. Testy nie potrzebują OpenAI, sekretów, DOM, przeglądarki ani pgTAP.

## Kluczowe podjęte decyzje

| Decyzja           | Wybór                                | Dlaczego                                                   | Źródło  |
| ----------------- | ------------------------------------ | ---------------------------------------------------------- | ------- |
| Model wykonania   | Synchroniczny pełny batch            | Progressive generation jest osobną zmianą architektoniczną | Plan    |
| Deadline          | 40 sekund na batch                   | Jeden limit zamiast timeoutu każdej próby                  | Plan    |
| Call budget       | 6 prób / 2 retry łącznie             | Cztery bazowe chunki bez mnożenia retry                    | Plan    |
| Token/cost budget | 4096 output/call i 0,02 USD/batch    | Przewidywalny worst case przed pierwszym call              | Plan    |
| Allowlista        | `gpt-6-luna`, prompt `v1`, 40 pytań  | Jedyny aktualny klient i cena fail-closed                  | Plan    |
| Konkurencja       | Idempotency key + jeden pending/user | Chroni retry, double-submit i dwa okna                     | Plan    |
| Telemetria        | Agregaty batcha                      | Wystarcza do dowodu bez ledgeru per attempt                | Plan    |
| Cancel            | Abort + `client_cancelled`           | Kolejne chunki nie mogą wydawać budżetu                    | Plan    |
| Auth              | `401` przed admission                | Guardraile wymagają tożsamości właściciela                 | Plan    |
| Test layer        | Vitest Node z DI                     | Najtańszy deterministyczny sygnał                          | Badania |

## Zakres

**W zakresie:** Vitest Node; polityka admission; wstrzykiwalny orkiestrator; `AbortSignal`; retry/call/token/USD guardrails; migracja telemetrii i idempotencji; jeden aktywny batch; terminalna persistencja; auth API; anulowanie klienta; cookbook test planu.

**Poza zakresem:** kolejka i progressive generation; limit USD per user/window; provider hard-spend config; per-attempt ledger; jsdom/Playwright/coverage; płatny smoke; pgTAP/RLS; pełna atomowość pytań i batcha.

## Architektura / Podejście

```text
Authenticated API + idempotency
            ↓
Admission policy → pending batch
            ↓
Orchestrator(provider, clock, policy)
            ↓
conditional pending → success | failed
```

Testowany core nie importuje OpenAI ani Supabase. Produkcyjne adaptery przekazują mu provider, czas i persistence, dzięki czemu te same limity obowiązują w kodzie i testach.

## Fazy w skrócie

| Faza                  | Co dostarcza                                      | Kluczowe ryzyko                       |
| --------------------- | ------------------------------------------------- | ------------------------------------- |
| 1. Vitest i admission | Runner oraz kanoniczna polityka fail-closed       | rozjazd limitów między warstwami      |
| 2. Orkiestrator       | Deadline, call budget, abort i accounting         | ukryte kolejne wywołania po timeout   |
| 3. Lifecycle          | Migracja, idempotencja i prawdziwy terminal state | race lub fałszywy sukces persistencji |
| 4. API i klient       | Auth, anulowanie, error mapping i cookbook        | klient uruchamia drugi koszt po retry |

**Wymagania wstępne:** Node 22.14, lokalny Supabase do weryfikacji migracji, aktualny flow 40 pytań i dostęp do zalogowanej sesji dla smoke testu.

**Szacowany wysiłek:** około 4 sesji implementacyjnych, po jednej na fazę, z ręcznym checkpointem po każdej.

## Otwarte ryzyka i założenia

- Lokalny abort nie dowodzi, że provider zatrzymał naliczanie; ceiling i telemetry są osobnymi zabezpieczeniami.
- `estimated_cost_usd` obejmuje tylko usage, które provider zwrócił aplikacji; nieobserwowalny koszt pozostaje ryzykiem zewnętrznym.
- Błąd finalizacji może pozostawić stale `pending`; kolejne admission odzyskuje taki rekord po 60 sekundach, ale nie udaje wcześniejszego sukcesu.
- Ceny w katalogu muszą być świadomie aktualizowane przy każdej zmianie dopuszczonego modelu.

## Kryteria sukcesu — podsumowanie

- Żaden test nie wykonuje płatnego wywołania, a `npm test`, `npm run lint` i `npm run build` przechodzą.
- Never-settling provider jest anulowany, nie uruchamia kolejnego chunku i pozostawia kontrolowany stan terminalny.
- Jeden batch nie przekracza sześciu prób, dwóch retry, 4096 output tokens/call ani 0,02 USD preflight ceiling.
- Auth, idempotency i constraint jednego pending chronią przed anonimowym oraz podwójnym wydatkiem.
