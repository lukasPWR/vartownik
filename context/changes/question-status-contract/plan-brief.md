# Statusy pytań — krótki plan

> Pełny plan: `context/changes/question-status-contract/plan.md`

## Co i dlaczego

F-02 ustala jeden kontrakt statusów dla flagowania pytania, jego przeglądu i wykluczenia z nowych sesji. Dziś trigger po zgłoszeniu ustawia `needs_review`, a dashboard liczy `flagged`, więc przyszła flaga z podsumowania nie trafiłaby do kolejki.

## Punkt wyjścia

Baza ma pięć statusów, ale nie określa przejść. API przyjmuje dowolny status i nadal używa testowego identyfikatora użytkownika. Generator tworzy nowe pytania; nie losuje obecnie z banku, natomiast wcześniej udany batch można ponownie użyć do utworzenia sesji.

## Pożądany stan końcowy

Nowe pytanie ma `active`; zgłoszenie daje `flagged`; jawne rozwiązanie, także bez edycji, daje `verified`; wycofanie daje `archived`. Tylko `active` i `verified` są dopuszczone do nowych sesji. Stara sesja pozostaje grywalna, gdy jej pytanie zostanie później oznaczone.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Kanoniczny status oczekującego | `flagged` | Pasuje do istniejącej listy i licznika | Użytkownik |
| Stary `needs_review` | Migracja do `flagged`, bez usuwania enuma | Zachowuje dane i jeden filtr kolejki | Plan |
| Rozwiązanie | `verified`, osobna akcja możliwa bez edycji | Zachowuje informację o ręcznym sprawdzeniu | Użytkownik |
| Ponowne zgłoszenie | `verified → flagged` | Nowy sygnał wraca do przeglądu | Użytkownik |
| Archiwum | Wykluczone, jawnie przywracalne do `active` | Umożliwia odzyskanie po pomyłce | Użytkownik + plan |
| Pytanie ręczne | `active` od utworzenia | Właściciel sam odpowiada za poprawność | Użytkownik |
| Wcześniejszy batch | Odmowa nowej sesji, jeśli zawiera wykluczone pytanie | Zgłoszone pytanie nie wraca przez ponowne użycie batcha | Użytkownik |
| Integracja AI | Bez zmiany generatora | Aktualny generator tworzy nowe pytania, a PRD zabrania zmiany integracji | PRD + kod |

## Zakres

**W zakresie:** migracja aliasu; bezpieczny trigger flagowania i reguły przejść; uwierzytelnienie tras pytań; blokada nowej sesji ze starym batchem; spójny licznik i lista `flagged`; testy oraz korekta dokumentacji.

**Poza zakresem:** UI flagowania z podsumowania, ekran zarządzania pytaniami, ręczne dodawanie oraz nowy mechanizm losowania z banku. Te funkcje mają własne fragmenty roadmapy.

**Podział odpowiedzialności:** F-02 dostarcza migrację `needs_review → flagged`, reguły przejść, odczyty kolejki i blokadę nowej sesji ze zgłoszonym lub zarchiwizowanym pytaniem. S-02 doda flagowanie z podsumowania rundy. S-04 doda ekran zarządzania, kartę zgłoszeń oraz jawne akcje rozwiązywania i przywracania. S-05 doda formularz ręcznego pytania, które zaczyna jako `active`. Wbrew starszemu zapisowi US-03 rozwiązanie zgłoszenia ustawia `verified`, a przywrócenie `archived` wymaga osobnej akcji i ustawia `active`.

## Architektura / Podejście

PostgreSQL egzekwuje przejścia i atomową weryfikację batcha przy tworzeniu sesji. Serwis i API mapują reguły na czytelne odpowiedzi HTTP. Dashboard i lista pytań używają `flagged` jako jedynego statusu nierozwiązanego zgłoszenia.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Baza | Migracja `needs_review`, przejścia i bezpieczny trigger | Utrata widoczności starych flag lub naruszenie izolacji |
| 2. API i sesja | Kontrolowane przejścia, auth i odmowa starego batcha | Wyścig między flagą a startem sesji |
| 3. Odczyty | Jeden sens licznika, listy i dokumentacji | Rozjazd filtrów w przyszłym UI |

**Wymagania wstępne:** lokalna odtwarzalna baza do weryfikacji migracji; F-01 jest wdrożone.
**Szacowany wysiłek:** około 2–3 sesje implementacyjne w trzech fazach.

## Otwarte ryzyka i założenia

- Nie ma dziś doboru pytań z banku; przyszła implementacja musi użyć statusów `active|verified`.
- Blokada ponownego startu starego batcha musi być atomowa względem równoległego flagowania.
- `question_edits` zapisuje ręczne zmiany poza transakcją samego `PATCH`; implementacja powinna zweryfikować spójność audytu przy błędzie zapisu.

## Kryteria sukcesu — podsumowanie

- Pytanie zgłoszone trafia do kolejki i licznika dokładnie raz, a po rozwiązaniu znika z obu.
- `flagged` i `archived` nie rozpoczynają nowej sesji ze starego batcha; istniejąca sesja działa dalej.
- Testy bazy dowodzą reguł przejść i izolacji użytkownika, a `npm test`, `npm run lint` i `npm run build` przechodzą.
