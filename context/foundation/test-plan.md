# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-26

## 1. Strategy

Testy w tym projekcie podlegają trzem zasadom:

1. **Cost × signal.** Wygrywa najtańszy test, który daje prawdziwy sygnał dla danego ryzyka. Nie promuj testu do e2e tylko dlatego, że e2e wydaje się bezpieczniejsze. Nie używaj oceny AI tam, gdzie regresję wykrywa sygnał deterministyczny.
2. **User concerns are first-class evidence.** Obawy wynikające z realnych doświadczeń użytkownika mają taką samą wagę jak PRD, roadmapa i sygnał z historii projektu.
3. **Risks are scenarios, not code locations.** This plan documents _what could fail_ and _why we believe it's likely_ — drawn from documents, interview, and codebase _signal_ (churn, structure, test base). It does NOT claim to know which line owns the failure. That knowledge is produced by `/10x-research` during each rollout phase. If the plan and research disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`. Skan z 2026-09-26 znalazł tylko 1 commit z ostatnich 30 dni, dlatego churn nie jest używany do oceny prawdopodobieństwa; oceny opierają się na roadmapie i wywiadzie.

## 2. Risk Map

Ryzyka są scenariuszami awarii w języku użytkownika i biznesu. Kolumna Source wskazuje dowód, który ujawnił ryzyko, a nie miejsce awarii w kodzie.

| #   | Risk (failure scenario)                                                                                                         | Impact | Likelihood | Source (evidence — not anchor)                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------- |
| 1   | Generowanie pytań trwa zbyt długo, a ponowienia lub nieograniczone wywołania przekraczają budżet providera AI.                  | High   | High       | interview Q1–Q2; `context/foundation/prd.md:89,178`                                      |
| 2   | Przepływ sesja → runda → próby → ukończenie wpada w niespójny stan, blokuje dalszą grę albo traci postęp.                       | High   | High       | interview Q3; `context/foundation/prd.md:68-76`; `context/foundation/roadmap.md:131-141` |
| 3   | Zalogowany użytkownik uzyskuje dostęp do cudzej sesji, rundy, próby lub pytania wskutek brakującej kontroli własności albo RLS. | High   | Medium     | `context/foundation/prd.md:84-88`; `AGENTS.md:35-36`                                     |
| 4   | Oflagowane pytanie nadal trafia do quizu albo nie daje się poprawnie przywrócić do obiegu.                                      | Medium | Medium     | `context/foundation/prd.md:105-109,131-144`; `context/foundation/roadmap.md:119-129`     |
| 5   | Niekompletna lub podwójnie zapisana samoocena daje błędny wynik rundy i mylące statystyki.                                      | Medium | Medium     | `context/foundation/prd.md:72-76,147-152`; `context/foundation/roadmap.md:167-177`       |

### Risk Response Guidance

| Risk | What would prove protection                                                                   | Must challenge                                                 | Context `/10x-research` must ground                                   | Likely cheapest layer       | Anti-pattern to avoid                                                |
| ---- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| #1   | Żądanie kończy się w ustalonym czasie, ma ograniczone retry i przewidywalny maksymalny koszt. | Sam timeout nie musi ograniczać liczby ani kosztu wywołań.     | Aktualny provider, timeout, retry, anulowanie, budżet i zapis błędów. | integration / contract      | Płatne wywołania i test wyłącznie happy-path.                        |
| #2   | Każde przejście stanu jest dozwolone dokładnie raz, a błędna kolejność nie modyfikuje danych. | Końcowe `200` nie dowodzi spójności wcześniejszych zapisów.    | Źródło stanu, kolejność operacji, idempotencja i atomowość.           | integration                 | Mockowanie wewnętrznych usług i kopiowanie implementacji do asercji. |
| #3   | Obcy i anonimowy użytkownik nie może czytać ani modyfikować zasobów właściciela.              | Samo zalogowanie nie oznacza prawa do wskazanego zasobu.       | RLS, role, JWT i kontrola własności dla każdej operacji.              | pgTAP/RLS + API integration | Wyłącznie pozytywne przypadki właściciela.                           |
| #4   | Oflagowane pytanie znika z generacji i wraca dopiero po świadomym rozwiązaniu.                | Zmiana etykiety w UI nie dowodzi wykluczenia z puli.           | Kanoniczny status oraz granica zapytania i generacji.                 | integration                 | Test samego renderowania statusu.                                    |
| #5   | Wynik powstaje raz, dopiero po kompletnej samoocenie, i zasila zgodne statystyki.             | Liczba zapisanych prób nie musi oznaczać kompletnej samooceny. | Trwały zapis verdictów, agregacja i obsługa duplikatów.               | integration                 | Skopiowanie obliczenia produkcyjnego do asercji.                     |

## 3. Phased Rollout

Każdy wiersz otwiera osobny folder zmiany przez `/10x-new`. Status jest stanem orchestratora i używa wyłącznie wartości z ustalonego słownika.

| #   | Phase name                              | Goal (one line)                                                                 | Risks covered | Test types                      | Status      | Change folder                 |
| --- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------- | ------------------------------- | ----------- | ----------------------------- |
| 1   | Fundament testów i kontrola generowania | Uruchomić runner i udowodnić ograniczenie czasu, retry oraz kosztu generowania. | #1            | integration, contract           | complete    | testing-generation-guardrails |
| 2   | Kontrakt stanów rundy                   | Chronić kolejność, kompletność i idempotencję przepływu rundy oraz samooceny.   | #2, #5        | service/API integration         | not started | —                             |
| 3   | Izolacja danych i status pytań          | Udowodnić deny-by-default dla obcych danych i poprawne wykluczanie flag.        | #3, #4        | pgTAP/RLS, integration          | not started | —                             |
| 4   | Minimalny smoke i bramy jakości         | Zablokować regresje przez najwęższy użyteczny smoke oraz automatyczne bramy.    | cross-cutting | minimal e2e/manual smoke, gates | not started | —                             |

Status vocabulary: `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

Klasyczna baza testowa jest obecnie sklasyfikowana jako **none**: brak runnera, konfiguracji, skryptów i plików testowych.

| Layer              | Tool                   | Version                          | Notes                                                                             |
| ------------------ | ---------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| unit + integration | none yet — see Phase 1 | —                                | Preferowany kierunek: Vitest z konfiguracją Astro; wybór ma potwierdzić research. |
| database / RLS     | Supabase CLI + pgTAP   | CLI `^2.23.4`                    | Narzędzie jest obecne; testów SQL jeszcze nie ma — see Phase 3.                   |
| e2e / smoke        | none yet — see Phase 4 | —                                | Tylko zachowania wymagające pełnego runtime; nie dublować integracji.             |
| lint + type check  | ESLint + `astro check` | ESLint `9.23.0`, Astro `^5.18.1` | Lokalne polecenia już istnieją; CI jeszcze nie istnieje.                          |

**Stack grounding tools (current session):**

- Docs: no docs MCP available; official Astro, Vitest, Vue Test Utils and Supabase documentation checked via web; checked: 2026-09-26
- Search: web search — official sources only; checked: 2026-09-26
- Runtime/browser: no Playwright/browser-automation MCP available; not used; checked: 2026-09-26
- Provider/platform: no Supabase/provider MCP available; official Supabase database-testing documentation checked via web; checked: 2026-09-26

## 5. Quality Gates

| Gate                            | Where                   | Required?                 | Catches                                                |
| ------------------------------- | ----------------------- | ------------------------- | ------------------------------------------------------ |
| lint + typecheck + build        | local; CI after Phase 4 | required                  | składnia, typy i regresje builda SSR                   |
| generation integration contract | local; CI after Phase 4 | required after §3 Phase 1 | nieograniczony czas, retry i koszt wywołań AI          |
| round/service integration       | local; CI after Phase 4 | required after §3 Phase 2 | niespójne przejścia stanów i błędna samoocena          |
| database RLS tests              | local; CI after Phase 4 | required after §3 Phase 3 | IDOR, brakujące deny cases i regresje polityk          |
| critical-session smoke          | CI on PR or pre-prod    | required after §3 Phase 4 | zerwany pełny przepływ wymagający runtime przeglądarki |

## 6. Cookbook Patterns

Jak dodawać testy w tym projekcie. Każdy wzorzec zostanie uzupełniony po dostarczeniu wskazanej fazy.

### 6.1 Ochrona timeoutu, retry i budżetu generowania

- Zaczynaj od failure-first: fake provider nigdy nie kończy odpowiedzi, fake timers przesuwają jeden deadline batcha, a kontrolowana persistencja potwierdza terminalny zapis bez prawdziwego OpenAI, sekretów i sieci.
- Minimalny zestaw obejmuje never-settling provider, retryable 429/5xx, trwałe 4xx, płatną odpowiedź odrzuconą po walidacji, globalny limit prób/retry, idempotentny replay, stale pending oraz błąd finalizacji. Osobno testuj admission nieznanego/za drogiego modelu przed pierwszym wywołaniem providera.
- Timeout, liczba wywołań i koszt są trzema niezależnymi asercjami. Sam abort nie dowodzi limitu wywołań ani provider-side billing; sprawdzaj też wspólny sygnał, brak późniejszych chunków i pełne agregaty attempts/retries/tokens/cost.

### 6.2 Test przejścia stanu rundy

- TBD — see §3 Phase 2 for the ordering, idempotency and persistence pattern.

### 6.3 Test izolacji właściciela i RLS

- TBD — see §3 Phase 3 for owner/stranger/anonymous allow-and-deny cases.

### 6.4 Test wykluczenia oflagowanego pytania

- TBD — see §3 Phase 3 for the flag/exclude/resolve behavior pattern.

### 6.5 Minimalny test pełnej sesji

- TBD — see §3 Phase 4 for the narrow browser/runtime smoke pattern.

### 6.6 Per-rollout-phase notes

- **Phase 1 — complete:** najtańszy wiarygodny sygnał dał Vitest w środowisku Node na granicy polityka → orkiestrator → lifecycle repository. Fake provider, fake clock i kontrolowana persistencja pozwalają dowodzić czasu, budżetu i stanu terminalnego bez DOM i płatnych wywołań.
- Test granicy HTTP powinien wstrzykiwać service i sprawdzać kolejność auth/admission przed nim. Klient POST powinien wstrzykiwać fetch, timer i generator klucza, aby testować reuse/rotation idempotency key oraz abort na timeout, cancel, retry i dispose bez jsdom.

## 7. What We Deliberately Don't Test

- **Kosztowne E2E dla zachowań pokrytych integracyjnie** — wybieraj integrację, jeżeli daje tańszy i pewniejszy sygnał. Oceń ponownie tylko wtedy, gdy tryb awarii wymaga pełnego runtime, sesji cookie lub zachowania przeglądarki. (Source: Phase 2 interview Q5.)
- **Szerokie snapshoty prezentacyjnego UI** — nie zostały uzasadnione przez mapę ryzyk. Oceń ponownie, jeżeli pojawi się konkretna regresja wizualna o istotnym wpływie.
- **Ocena AI nad sygnałem deterministycznym** — nie dodawaj warstwy AI-native, gdy kontrakt, pgTAP lub integracja wykrywa tę samą awarię.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-26
- Stack versions last verified: 2026-09-26
- AI-native tool references last verified: 2026-09-26

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
