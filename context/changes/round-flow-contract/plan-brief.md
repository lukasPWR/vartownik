# Brief: round-flow-contract

Pełny plan: `context/changes/round-flow-contract/plan.md`

## Punkt wyjścia

- Frontend już wywołuje brakujące kontrakty rund i prób w `src/components/game/GameView.vue:180` oraz `src/components/game/QuizFocusMode.vue:50`.
- DTO dla `RoundDTO`, `CompleteRoundResponseDTO` i `AttemptDTO` są już ustalone w `src/types.ts:293`.
- `createSession()` nie materializuje dziś rekordów `rounds` z `generation_batches.response_payload.rounds`, mimo że generator zapisuje ten mapping w `src/lib/services/generation-batch.service.ts:337`.

## Kluczowe decyzje

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Reveal contract | Obejmuje `GET round`, `POST attempt`, `POST round complete` | `S-01` ma dostać gotowy backend bez późniejszego dopisywania semantyki |
| Źródło rund | `generation_batches.response_payload.rounds` | to jedyny kanoniczny mapping batch -> round/question_ids |
| Duplikat próby | `409 Conflict` | zgodność z `uq_attempts_round_position` i prosty model |
| Dostęp do rund | tylko bieżąca runda | brak przeskakiwania i przedwczesnego reveal |
| `verdict` | dopiero po `round complete` | odpowiedzi są odsłaniane dopiero po końcu rundy |
| Koniec sesji | ostatni `round complete` zamyka sesję | jeden atomowy kontrakt końca flow |
| Analytics | poza zakresem F-01 | fundament kończy się na danych źródłowych |

## Zakres

**W zakresie:**
- materializacja `rounds` przy `POST /api/sessions`
- `GET /api/sessions/:sessionId/rounds/:position`
- `POST /api/rounds/:roundId/attempts`
- `POST /api/sessions/:sessionId/rounds/:roundId/complete`
- automatyczne `sessions.status = completed` po ukończeniu rundy 4

**Poza zakresem:**
- UI summary/self-assessment
- `PATCH /api/attempts/:id` dla `verdict` i flagowania
- `category_stats_daily` i dashboard analytics

## Architektura / Podejście

Sesja staje się miejscem materializacji rund: `createSession()` po walidacji batcha tworzy rekord `sessions`, buduje 4 rekordy `rounds` z `response_payload.rounds` i dopiero wtedy zwraca `SessionCreatedDTO`. Nowe serwisy rund i prób pilnują dwóch zasad produktu: tylko bieżąca runda jest dostępna oraz `correct_answer` pozostaje ukryte, dopóki `complete round` nie przełączy rundy na `completed`. Ten sam endpoint dla rundy 4 atomowo kończy także sesję.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Materializacja sesji | `POST /api/sessions` tworzy realne `rounds` z batch payloadu | niepełny lub niespójny payload |
| 2. Odczyt rundy i zapis prób | działające endpointy `GET round` i `POST attempt` | zgodność ownership, pozycji i orderu pytań |
| 3. Complete i finalizacja | reveal odpowiedzi i auto-complete sesji | nieatomowy koniec rundy 4 |

**Wymagania wstępne:** brak destrukcyjnych migracji, zachowanie obecnych DTO i RLS.  
**Szacowany wysiłek:** ~2-3 sesje robocze w 3 fazach.

## Otwarte ryzyka i założenia

- Historyczne batch’e bez `response_payload.rounds` mogą nie nadawać się do tworzenia nowych sesji.
- Atomowość `round complete` + `session complete` może wymagać RPC lub bardzo ostrożnej sekwencji update’ów.
- Obecny klient gry nie używa jeszcze `complete round`; pierwszy pełny konsument pojawi się w `S-01`.

## Kryteria sukcesu

- Gra może utworzyć sesję z realnymi rekordami `rounds`, pobrać tylko bieżącą rundę i zapisywać dokładnie jedną próbę na pozycję.
- Odpowiedzi są odsłaniane dopiero po jawnym `round complete`.
- Ukończenie rundy 4 automatycznie kończy sesję, ale bez wdrażania jeszcze samooceny i analytics.
