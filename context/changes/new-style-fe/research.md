---
date: 2026-09-26T18:43:54+02:00
researcher: Codex
git_commit: b9fbb0d71fe684ab5fda366a2900d624bd178e25
branch: feat/new-style-fe
repository: lukasPWR/vartownik
topic: "Zmiana stylu wszystkich widoków: bez fioletu, z shadcn-vue i motywem inspirowanym Uberem"
tags: [research, codebase, frontend, theme, shadcn-vue]
status: complete
last_updated: 2026-09-26
last_updated_by: Codex
---

# Research: Spójny motyw wszystkich widoków

**Date**: 2026-09-26T18:43:54+02:00  
**Researcher**: Codex  
**Git Commit**: b9fbb0d71fe684ab5fda366a2900d624bd178e25  
**Branch**: feat/new-style-fe  
**Repository**: lukasPWR/vartownik

## Research Question

Jak zmienić obecny, dominujący fioletowy styl aplikacji na spójny motyw inspirowany Uberem, wykorzystując shadcn-vue we wszystkich dostępnych widokach? Punktem odniesienia jest dostarczony zrzut dashboardu.

## Summary

- Aplikacja ma już skonfigurowane shadcn-vue, Tailwind 4 i wspólne tokeny CSS. Dostępne komponenty UI to Button, Input, Badge i Table. Ich warianty korzystają z tokenów semantycznych, więc centralna zmiana palety obejmie część interfejsu ([konfiguracja](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/components.json#L1), [warianty Button](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/ui/button/index.ts#L6), [tokeny](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L15)).
- Obecny dashboard, strona startowa i auth mają fiolet zapisany bezpośrednio w klasach Tailwind. Wykres ma osobne kolory RGBA w JavaScript. Zmiana `--primary` w CSS nie zmieni tych miejsc ([dashboard](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/dashboard.astro#L63), [wykres](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/CategoryRadarChart.vue#L107)).
- Dostępne widoki to `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/dashboard` i `/game`. Ekran gry ma także stany ładowania, błędu i aktywnego quizu. Brak osobnego widoku podsumowania rundy lub panelu CRUD w bieżącym `src/pages/` ([routing strony startowej](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/index.astro#L1), [gra](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/game.astro#L1)).
- W CSS są dodatkowe zestawy stylów `data-mode="focus|dashboard|crud"`, ale żaden aktualny komponent nie ustawia tych atrybutów. Projekt nowego motywu powinien uwzględnić faktycznie używany interfejs oparty na tokenach shadcn i klasach widoków ([selektory CSS](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L214)).

## Detailed Findings

### Wspólna warstwa stylów i shadcn-vue

- [Layout.astro](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/layouts/Layout.astro#L1) importuje `global.css` na każdej stronie. Dokument nie ustawia klasy `.dark` ani przełącznika motywu. Przeglądarka otrzymuje jasne tokeny `:root`, mimo że dashboard i auth mają ciemne tła wpisane lokalnie. Jest to źródło niespójności między widokami.
- [global.css:15-51](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L15) definiuje jasne tokeny shadcn; `--primary`, `--accent-foreground`, `--ring` i część tokenów sidebaru są fioletowe. [global.css:102-138](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L102) definiuje ciemne odpowiedniki pod `.dark`. [Mapowanie Tailwind 4](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L166) udostępnia te wartości jako klasy semantyczne.
- [components.json](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/components.json#L1) ustawia styl `new-york`, bazę `neutral` i `cssVariables: true`; [astro.config.mjs](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/astro.config.mjs#L6) włącza Tailwind 4. Zainstalowane prymitywy shadcn-vue to Button, Input, Badge i Table (`src/components/ui/`); karty i textarea w widokach są obecnie własnym markupem.
- [Button](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/ui/button/index.ts#L6) i [Badge](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/ui/badge/index.ts#L6) korzystają z `bg-primary`, `text-primary-foreground`, `bg-secondary` i stanów `focus-visible`. Część instancji nadpisuje te wartości klasami lokalnymi, więc wspólne tokeny mają ograniczony zasięg.
- [global.css:53-99](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L53) oraz [global.css:214-578](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L214) zawierają odrębne palety i selektory dla focus, dashboard i CRUD. W `src/` nie ma użycia `data-mode`, więc te selektory nie stylują obecnych ekranów.

### Inwentarz dostępnych widoków

| Widok | Obecna konstrukcja | Miejsca do objęcia zmianą |
| --- | --- | --- |
| `/` | [Welcome.astro:18-105](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/Welcome.astro#L18) | Fioletowo-niebieski gradient, nagłówki gradientowe, szklane panele, startowa treść o technologiach i [LibBadge.astro:10-12](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/ui/LibBadge.astro#L10). |
| Logowanie i rejestracja | [signin.astro:6-23](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/auth/signin.astro#L6), [signup.astro:6-23](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/auth/signup.astro#L6) | Tło gradientowe i przezroczyste karty. Formularze używają Input/Button, ale [SignInForm.vue:84-147](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/auth/SignInForm.vue#L84) i [SignUpForm.vue:101-189](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/auth/SignUpForm.vue#L101) narzucają własne kolory, w tym fioletowe obramowania focus i przyciski. |
| Potwierdzenie email | [confirm-email.astro:21-38](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/auth/confirm-email.astro#L21) | Ten sam gradient, karta i fioletowy link; różne teksty zależne od stanu potwierdzenia. |
| Dashboard | [dashboard.astro:63-122](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/dashboard.astro#L63) | Gradient tła, [Topbar.astro:5-30](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/Topbar.astro#L5), przycisk startu, karty statystyk, lista do przejrzenia, wykres i tabela sesji. |
| Gra | [game.astro:5-14](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/game.astro#L5), [GameView.vue:303-329](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/GameView.vue#L303) | Ekran generowania, błędu i quizu. Większość elementów używa tokenów shadcn; szczególnej uwagi wymagają licznik czasu, wskaźniki postępu i stany disabled. |

### Dashboard i dane wizualne

- [QuickStartWidget.astro:6-29](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/QuickStartWidget.astro#L6), [StatCard.astro:11-22](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/StatCard.astro#L11) i [PendingReviewsWidget.astro:20-61](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/PendingReviewsWidget.astro#L20) mają białe teksty, półprzezroczyste białe tła/obramowania i lokalne fioletowe akcenty. `QuickStartWidget` wykorzystuje `buttonVariants`, lecz reszta karty jest lokalna.
- [StatsOverviewWidget.astro:15-55](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/StatsOverviewWidget.astro#L15) koduje czerwony, żółty i zielony jako znaczenie wyniku lub ostrzeżenia. Należy zachować znaczenie stanów przy doborze nowej palety.
- [RecentSessionsTable.vue:105-193](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/RecentSessionsTable.vue#L105) używa shadcn Table/Badge, ale nadpisuje nagłówki, komórki, linki, spinner i paginację bielą oraz fioletem. Zmiana tokenów tabeli nie obejmie tych nadpisań.
- [CategoryRadarChart.vue:107-149](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/CategoryRadarChart.vue#L107) wpisuje fioletowy dataset oraz białe etykiety i siatkę bezpośrednio w konfiguracji Chart.js. [Filtry dat i stany](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/CategoryRadarChart.vue#L152) też zakładają ciemne tło.

### Gra i stany interakcji

- [GenerationLoadingScreen.vue:25-44](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/GenerationLoadingScreen.vue#L25) łączy fazy ładowania, karuzelę faktów i przycisk anulowania. Przy błędzie pojawia się [GenerationErrorMessage.vue:91-103](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/GenerationErrorMessage.vue#L91) z retry i powrotem; retry może być czasowo niedostępne. Nowy motyw powinien objąć te stany, nie tylko właściwe pytanie.
- [QuizFocusMode.vue:143-188](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/QuizFocusMode.vue#L143) składa nagłówek rundy, licznik, pytanie, scratchpad i postęp. [QuestionBlock.vue:24-44](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/QuestionBlock.vue#L24) oraz [Scratchpad.vue:54-68](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/Scratchpad.vue#L54) opierają główne kolory o tokeny, więc centralna paleta będzie tam skuteczna.
- [TimerWidget.vue:27-37](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/TimerWidget.vue#L27) koduje progi czasu jako zielony/żółty/czerwony. [RoundHeader.vue:15-37](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/RoundHeader.vue#L15) używa wariantu `destructive` dla wysokiej trudności, a [QuestionProgressIndicator.vue:10-25](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/QuestionProgressIndicator.vue#L10) używa tokenu `primary`. Warto rozdzielić znaczenie zagrożenia/błędu od trudności, jeśli motyw ma mieć konsekwentną semantykę.
- Gra nie ma obecnie odrębnego widoku wyników rundy w `src/components/game/`. Po zakończeniu dostępny przepływ prowadzi do dashboardu ([GameView.vue:252-270](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/GameView.vue#L252)).

## Code References

- [src/styles/global.css:15-51,102-138,166-211](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/styles/global.css#L15) — tokeny bazowe, wariant ciemny i mapowanie Tailwind.
- [src/layouts/Layout.astro:1-23](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/layouts/Layout.astro#L1) — wspólny import CSS i dokument HTML.
- [src/pages/dashboard.astro:63-122](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/pages/dashboard.astro#L63) — układ i tło dashboardu.
- [src/components/dashboard/CategoryRadarChart.vue:107-149](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/CategoryRadarChart.vue#L107) — osobna paleta wykresu.
- [src/components/auth/SignInForm.vue:84-147](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/auth/SignInForm.vue#L84) — nadpisania Input/Button.
- [src/components/game/QuizFocusMode.vue:143-188](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/game/QuizFocusMode.vue#L143) — kompozycja aktywnego quizu.

## Architecture Insights

- Warstwa globalna już oferuje semantyczne tokeny, ale ekran startowy, auth i dashboard tworzą własny, ciemny system przez klasy Tailwind. Największa praca dotyczy ujednolicenia tych warstw oraz kolorów spoza CSS, szczególnie Chart.js.
- Astro renderuje strony i statyczne karty, a Vue obsługuje formularze, wykres, tabelę sesji i grę. Istniejące Button/Input/Badge/Table można wykorzystać w Vue; dla Astro jest już przykład współdzielenia `buttonVariants` w [QuickStartWidget.astro:29](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/QuickStartWidget.astro#L29).
- Niski kontrast grozi przede wszystkim po przeniesieniu białych tekstów o małej przezroczystości na jasne karty. W obecnym kodzie część linków usuwa obrys focus bez zastępczego wskaźnika ([PendingReviewsWidget.astro:50-61](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/PendingReviewsWidget.astro#L50)); pola dat używają tylko zmiany koloru obramowania ([CategoryRadarChart.vue:163-179](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/dashboard/CategoryRadarChart.vue#L163)).
- `Layout.astro` ustawia `lang="en"`, choć teksty widoków są po polsku ([Layout.astro:11](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/layouts/Layout.astro#L11)). To poboczna uwaga dostępności przy przebudowie wspólnego layoutu.

## Historical Context (from prior changes)

- [context/foundation/tech-stack.md:1-10](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/context/foundation/tech-stack.md#L1) wybiera Tailwind 4 i shadcn-vue dla frontendu. Obecna konfiguracja i komponenty potwierdzają, że biblioteka już jest częścią projektu.
- [context/foundation/shape-notes.md:27-36](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/context/foundation/shape-notes.md#L27) wymienia istniejące widoki i brakujące funkcje. Planowane w innych zmianach podsumowanie rundy oraz CRUD nie są jeszcze stronami dostępnymi do zmiany motywu.
- Przeszukanie `context/changes/` i `context/archive/` nie wykazało wcześniejszej decyzji o docelowej palecie ani osobnego planu przebudowy wizualnej.

## Related Research

Brak wcześniejszego badania dotyczącego motywu lub stylu interfejsu w `context/changes/` i `context/archive/`.

## Open Questions

- Czy kierunek „jak Uber” oznacza jasne, białe powierzchnie z czarną typografią i czarnymi akcjami, czy ciemny interfejs? Obecne ekrany mieszają ciemne i jasne rozwiązania, a wymaganie nie wybiera wariantu.
- Czy strona `/` ma zachować startową treść o stosie technologicznym w nowym stylu, czy powinna stać się stroną produktu? Sama zawartość [Welcome.astro:29-105](https://github.com/lukasPWR/vartownik/blob/b9fbb0d71fe684ab5fda366a2900d624bd178e25/src/components/Welcome.astro#L29) nadal opisuje starter.
- Które neutralne i semantyczne kolory mają reprezentować wynik, ostrzeżenie, błąd oraz upływ czasu? Wykres, statystyki i licznik wymagają spójnej decyzji wykraczającej poza zmianę tła.
