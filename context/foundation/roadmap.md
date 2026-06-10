---
project: VARtownik
version: 1
status: draft
created: 2026-06-09
updated: 2026-06-09
prd_version: 1
main_goal: speed
top_blocker: decisions
---

# Mapa drogowa: VARtownik

> Wygenerowano z `context/foundation/prd.md` (v1) + automatycznie zbadana baza kodu.
> Edytuj na miejscu; archiwizuj po zastapieniu.
> Fragmenty ponizej sa wymienione w kolejnosci zaleznosci. Tabela "W skrocie" to indeks.

## Podsumowanie wizji

VARtownik ma domknac istniejacy symulator pilkarskiego quizu tak, aby prywatny uzytkownik mogl przejsc pelna sesje treningowa bez martwego konca: generowanie, gra pod presja czasu, podsumowanie rundy, samoocena, zapis wyniku i odswiezone statystyki. Najwieksza luka nie lezy w bazowym stosie technologicznym, tylko w brakujacym przeplywie po rundzie oraz w zarzadzaniu jakoscia pytan wygenerowanych przez AI. Sekwencja jest ustawiona pod szybkie doprowadzenie pierwszej pelnej sesji do stanu dzialajacego, z zachowaniem obecnego uwierzytelniania, danych i zasad izolacji uzytkownika.

## Gwiazda przewodnia

**S-01: Uzytkownik konczy runde i zapisuje samoocene** - to pierwszy kamien walidacyjny, czyli najmniejszy kompletny fragment pokazujacy, czy najwazniejszy przeplyw produktu dziala od konca rundy do danych treningowych.

> "Gwiazda przewodnia" oznacza tutaj najmniejszy, kompletny fragment, ktorego dostarczenie udowadnia podstawowe zalozenie produktu; umieszczamy go tak wczesnie, jak pozwalaja wymagania wstepne, bo kolejne funkcje maja sens dopiero wtedy, gdy ten przeplyw dziala.

## W skrocie

| ID | Change ID | Wynik (uzytkownik moze...) | Wymagania wstepne | Odwolania do PRD | Status |
|---|---|---|---|---|---|
| F-01 | round-flow-contract | (fundament) przeplyw rundy ma minimalna umowe potrzebna do pobrania rundy, zapisania prob i ujawnienia odpowiedzi po zakonczeniu rundy | - | US-01, FR-006, FR-007, FR-008, FR-010 | gotowy |
| F-02 | question-status-contract | (fundament) statusy pytan maja jednoznaczna semantyke dla flagowania, wykluczania i rozwiazywania bledow | - | US-02, US-03, FR-009, FR-015, FR-016 | gotowy |
| F-03 | deployment-runtime-checkpoint | (fundament) aktualny cel uruchomieniowy jest sprawdzony przed zmianami, ktore dotykaja auth, API i SSR | - | FR-001, FR-002, Guardrails | gotowy |
| S-01 | round-summary-self-assessment | uzytkownik po rundzie widzi pytania, poprawne odpowiedzi i swoje notatki, oznacza wszystkie pytania i zapisuje wynik rundy | F-01 | US-01, FR-004, FR-005, FR-006, FR-007, FR-008, FR-010 | proponowany |
| S-02 | summary-question-flagging | uzytkownik flaguje podejrzane pytanie bez opuszczania podsumowania, a pytanie nie wraca do kolejnych quizow | S-01, F-02 | US-02, FR-009, FR-016 | proponowany |
| S-03 | full-session-completion | uzytkownik przechodzi wszystkie 4 rundy od wygenerowania quizu do zapisanego wyniku sesji bez martwego konca | S-01, S-02, F-03 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-010 | proponowany |
| S-04 | question-bank-review | uzytkownik przeglada bank pytan, widzi zakladke z podejrzanymi pytaniami, edytuje, usuwa lub przywraca pytania | F-02 | US-03, FR-011, FR-013, FR-014, FR-015, FR-016 | proponowany |
| S-05 | manual-question-entry | uzytkownik dodaje nowe pytanie recznie z odpowiedzia, kategoria i poziomem trudnosci | F-02 | FR-012 | proponowany |
| S-06 | dashboard-training-analytics | uzytkownik widzi na dashboardzie trafnosc ogolna, trafnosc per kategoria i ostatnie 10 sesji na podstawie samooceny | S-03 | FR-018, FR-019, FR-020 | proponowany |

## Strumienie

Pomoc nawigacyjna - grupuje elementy, ktore dziela lancuch wymagan wstepnych. Kanoniczna kolejnosc nadal znajduje sie w grafie zaleznosci ponizej; ta tabela to proponowana kolejnosc czytania w rownoleglych sciezkach.

| Strumien | Temat | Lancuch | Uwaga |
|---|---|---|---|
| A | Pelna sesja treningowa | `F-01` -> `S-01` -> `S-02` -> `S-03` -> `S-06` | To glowna sciezka, bo najszybciej prowadzi do pelnej sesji bez martwego konca. |
| B | Jakosc banku pytan | `F-02` -> `S-04` -> `S-05` | Wspiera glowna sciezke przez usuwanie blednych pytan z obiegu i moze isc rownolegle po `F-02`. |
| C | Gotowosc uruchomieniowa | `F-03` | Samodzielny checkpoint chroni obecne auth, SSR i generowanie przed regresja podczas prac produktowych. |

## Baza

Co juz jest na miejscu w bazie kodu na dzien `2026-06-09` (automatycznie zbadane + potwierdzone przez uzytkownika).
Fundamenty ponizej zakladaja, ze te elementy sa obecne i NIE tworza ich ponownie.

- **Frontend:** obecny - Astro 5 SSR, Vue 3 islands, Tailwind, shadcn-vue, komponenty gry i dashboardu.
- **Backend / API:** czesciowy - istnieja API auth, pytan, sesji i statystyk; brakuje spietej powierzchni rund/prob wymaganej przez klienta gry.
- **Dane:** obecny - Supabase, migracje, tabele questions/sessions/rounds/attempts/category_stats_daily, RLS i indeksy.
- **Uwierzytelnianie:** obecny - Supabase SSR client, cookie-based sessions i middleware chroniace dashboard oraz gre.
- **Wdrozenie / infrastruktura:** czesciowy - kod i skrypty wskazuja Cloudflare Workers, starszy dokument tech-stack nadal opisuje DigitalOcean/Docker.
- **Obserwowalnosc:** czesciowy - istnieje lokalne logowanie bledow przez `console.error`, brak zewnetrznego monitoringu lub metryk.

## Fundamenty

### F-01: Minimalna umowa przeplywu rundy

- **Wynik:** (fundament) gra ma minimalna umowe do pobrania danych rundy, zapisania odpowiedzi/samooceny i ujawnienia poprawnych odpowiedzi po zakonczeniu rundy.
- **Change ID:** round-flow-contract
- **Odwolania do PRD:** US-01, FR-006, FR-007, FR-008, FR-010
- **Odblokowania:** S-01, S-02, S-03
- **Wymagania wstepne:** -
- **Rownolegle z:** F-02, F-03
- **Blokady:** -
- **Niewiadome:** Czy zapis prob powinien pozostac oddzielony od zatwierdzenia rundy, czy zatwierdzenie rundy ma byc jedna operacja? - Wlasciciel: zespol. Blokada: nie.
- **Ryzyko:** Bez tego fundamentu UI podsumowania moze powstac szybciej, ale nie bedzie mial stabilnej sciezki zapisu i odczytu.
- **Status:** gotowy

### F-02: Minimalna umowa statusow pytan

- **Wynik:** (fundament) statusy pytan rozrozniaja pytania aktywne, podejrzane, rozwiazane i usuniete z obiegu w sposob wystarczajacy dla flagowania oraz panelu zarzadzania.
- **Change ID:** question-status-contract
- **Odwolania do PRD:** US-02, US-03, FR-009, FR-015, FR-016
- **Odblokowania:** S-02, S-04, S-05
- **Wymagania wstepne:** -
- **Rownolegle z:** F-01, F-03
- **Blokady:** -
- **Niewiadome:** Czy istniejace statusy `flagged` i `needs_review` reprezentuja dwa rozne stany, czy jeden z nich powinien byc uzywany jako stan podejrzanego pytania? - Wlasciciel: zespol. Blokada: nie.
- **Ryzyko:** Niejednoznaczne statusy moga sprawic, ze pytanie oznaczone w grze nie pojawi sie w odpowiedniej zakladce panelu albo nie zostanie wykluczone z quizu.
- **Status:** gotowy

### F-03: Checkpoint runtime i wdrozenia

- **Wynik:** (fundament) aktualny runtime aplikacji jest potwierdzony przed pracami, ktore dotykaja chronionych tras, SSR i generowania quizu.
- **Change ID:** deployment-runtime-checkpoint
- **Odwolania do PRD:** FR-001, FR-002, Guardrails
- **Odblokowania:** S-03
- **Wymagania wstepne:** -
- **Rownolegle z:** F-01, F-02, S-04, S-05
- **Blokady:** -
- **Niewiadome:** Czy `tech-stack.md` powinien zostac zaktualizowany do obecnej decyzji Cloudflare Workers przed pierwszym planem wdrozeniowym? - Wlasciciel: uzytkownik. Blokada: nie.
- **Ryzyko:** Rozbieznosc dokumentow moze wprowadzic przyszle plany w zly cel wdrozenia, ale nie musi blokowac pracy nad pierwszym przeplywem produktu.
- **Status:** gotowy

## Fragmenty

### S-01: Podsumowanie rundy i samoocena

- **Wynik:** uzytkownik po 10 pytaniach widzi podsumowanie rundy z poprawnymi odpowiedziami i notatkami, oznacza kazde pytanie jako znane lub nieznane, a wynik rundy zostaje zapisany.
- **Change ID:** round-summary-self-assessment
- **Odwolania do PRD:** US-01, FR-004, FR-005, FR-006, FR-007, FR-008, FR-010
- **Wymagania wstepne:** F-01
- **Rownolegle z:** F-02, F-03, S-04, S-05
- **Blokady:** -
- **Niewiadome:** -
- **Ryzyko:** To najwczesniejszy widoczny przeplyw po rundzie; jesli zostanie odlozony, aplikacja nadal nie domknie sesji treningowej.
- **Status:** proponowany

### S-02: Flagowanie pytan z podsumowania

- **Wynik:** uzytkownik oznacza podejrzane pytanie na ekranie podsumowania, a oznaczone pytanie jest wykluczone z kolejnych quizow do czasu rozwiazania.
- **Change ID:** summary-question-flagging
- **Odwolania do PRD:** US-02, FR-009, FR-016
- **Wymagania wstepne:** S-01, F-02
- **Rownolegle z:** S-04, S-05
- **Blokady:** -
- **Niewiadome:** -
- **Ryzyko:** Wdrozenie flagowania dopiero w panelu zarzadzania omineloby moment, w ktorym uzytkownik faktycznie zauważa blad.
- **Status:** proponowany

### S-03: Pelna sesja 4 rund bez martwego konca

- **Wynik:** uzytkownik od logowania i wygenerowania quizu przechodzi wszystkie 4 rundy, zachowujac timer, scratchpad, ekran ladowania i zapis koncowego wyniku.
- **Change ID:** full-session-completion
- **Odwolania do PRD:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-010
- **Wymagania wstepne:** S-01, S-02, F-03
- **Rownolegle z:** S-04, S-05
- **Blokady:** -
- **Niewiadome:** -
- **Ryzyko:** Ten fragment scala zachowania juz istniejace z nowymi; glownym ryzykiem jest regresja w timerze, generowaniu albo sesjach auth.
- **Status:** proponowany

### S-04: Przeglad i naprawa banku pytan

- **Wynik:** uzytkownik widzi swoj bank pytan, przechodzi do zakladki podejrzanych pytan z licznikiem, edytuje tresc lub odpowiedz, usuwa pytanie albo przywraca je do obiegu.
- **Change ID:** question-bank-review
- **Odwolania do PRD:** US-03, FR-011, FR-013, FR-014, FR-015, FR-016
- **Wymagania wstepne:** F-02
- **Rownolegle z:** S-01, S-02, S-03
- **Blokady:** -
- **Niewiadome:** Czy usuniecie pytania z istniejacymi probami ma byc twardo blokowane i zamieniane na archiwizacje w UI? - Wlasciciel: zespol. Blokada: nie.
- **Ryzyko:** Panel bez jasnej sciezki rozwiazania flag bedzie tylko lista danych, a nie workflow czyszczenia banku.
- **Status:** proponowany

### S-05: Reczne dodawanie pytan

- **Wynik:** uzytkownik dodaje nowe pytanie recznie, podajac tresc, poprawna odpowiedz, kategorie i poziom trudnosci.
- **Change ID:** manual-question-entry
- **Odwolania do PRD:** FR-012
- **Wymagania wstepne:** F-02
- **Rownolegle z:** S-01, S-02, S-03, S-04
- **Blokady:** -
- **Niewiadome:** Czy recznie dodane pytanie ma od razu status aktywny, czy powinno przejsc stan weryfikacji? - Wlasciciel: zespol. Blokada: nie.
- **Ryzyko:** Dodawanie pytan przed przegladem banku mogloby stworzyc kolejny formularz bez miejsca do pozniejszej korekty, dlatego jest za fragmentem statusow i obok panelu.
- **Status:** proponowany

### S-06: Dashboard oparty na samoocenie

- **Wynik:** uzytkownik widzi ogolny procent poprawnych odpowiedzi, trafnosc per kategoria oraz ostatnie 10 sesji obliczone z zapisanych samoocen.
- **Change ID:** dashboard-training-analytics
- **Odwolania do PRD:** FR-018, FR-019, FR-020
- **Wymagania wstepne:** S-03
- **Rownolegle z:** S-04, S-05
- **Blokady:** -
- **Niewiadome:** Czy kategorie bez danych maja byc ukryte, czy wyswietlane z wartoscia zerowa? - Wlasciciel: zespol. Blokada: nie.
- **Ryzyko:** Dashboard ma juz elementy prezentacyjne, ale bez pelnej sesji i samoocen latwo pokazac puste lub mylace metryki.
- **Status:** proponowany

## Przekazanie do backlogu

| ID mapy drogowej | Change ID | Sugerowany tytul zadania | Gotowe do `/10x-plan` | Uwagi |
|---|---|---|---|---|
| F-01 | round-flow-contract | Ustal minimalna umowe przeplywu rundy | tak | Uruchom `/10x-plan round-flow-contract` |
| F-02 | question-status-contract | Ustal minimalna umowe statusow pytan | tak | Uruchom `/10x-plan question-status-contract` |
| F-03 | deployment-runtime-checkpoint | Potwierdz runtime i cel wdrozenia | tak | Uruchom `/10x-plan deployment-runtime-checkpoint` |
| S-01 | round-summary-self-assessment | Zbuduj podsumowanie rundy z samoocena | nie | Wymaga F-01 |
| S-02 | summary-question-flagging | Dodaj flagowanie pytan z podsumowania | nie | Wymaga S-01 i F-02 |
| S-03 | full-session-completion | Domknij pelna sesje 4 rund | nie | Wymaga S-01, S-02 i F-03 |
| S-04 | question-bank-review | Zbuduj przeglad i naprawe banku pytan | nie | Wymaga F-02 |
| S-05 | manual-question-entry | Dodaj reczne tworzenie pytan | nie | Wymaga F-02 |
| S-06 | dashboard-training-analytics | Podlacz dashboard do samooceny | nie | Wymaga S-03 |

Ta tabela to czyste przekazanie do Jira/Linear lub dowolnego backlogu opartego na MCP. Zawiera jeden wiersz dla kazdego `F-NN` i `S-NN`.

## Otwarte pytania dotyczace mapy drogowej

1. **What is `target_scale.qps`?** - Wlasciciel: uzytkownik. Blokada: roadmap-wide nie; informacyjne dla oceny infrastruktury i kosztow.
2. **What is `target_scale.data_volume`?** - Wlasciciel: uzytkownik. Blokada: roadmap-wide nie; informacyjne dla przyszlych limitow i indeksowania.
3. **Czy zaktualizowac `tech-stack.md`, aby zgadzal sie z obecna decyzja Cloudflare Workers?** - Wlasciciel: uzytkownik. Blokada: F-03 nie; blokuje tylko czystosc pozniejszych planow wdrozeniowych.

## Zaparkowane

- **Multiplayer lub wspolne quizy** - Dlaczego zaparkowane: PRD Non-Goals wyklucza leaderboards, shared decks i team training modes.
- **Konta organizacji lub role zespolowe** - Dlaczego zaparkowane: PRD Non-Goals utrzymuje plaski, prywatny model jednego uzytkownika.
- **Publiczny lub wspoldzielony bank pytan** - Dlaczego zaparkowane: PRD Non-Goals zaklada prywatne pytania kazdego uzytkownika.
- **Zalaczniki obrazow do recznie dodawanych pytan (FR-017)** - Dlaczego zaparkowane: PRD oznacza to jako nice-to-have, wiec nie powinno blokowac pelnej sesji ani panelu zarzadzania.

## Zrobione

Brak wpisow. `/10x-archive` dodaje tutaj wpis i zmienia `Status` tego elementu na `done`, gdy zmiana, ktorej `Change ID` odpowiada elementowi mapy drogowej, zostanie zarchiwizowana.
