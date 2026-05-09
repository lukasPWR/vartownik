<conversation_summary> <decisions>

1. **Rygorystyczna blokada sesji**: Zdecydowano o wdrożeniu `beforeunload` oraz Navigation Guards w Vue Routerze, aby zapobiec przypadkowej utracie postępu w aktywnej rundzie (zgodnie z US-007).
    
2. **Dwufazowy model wizualny**: Przyjęto podział na "Tryb Focus" (ciemny, minimalistyczny interfejs podczas quizu) oraz "Tryb Review" (jasny, analityczny interfejs po rundzie).
    
3. **Mechanizm samooceny**: Wybrano układ side-by-side do porównywania scratchpadu z odpowiedzią AI, wspierany skrótami klawiszowymi na desktopie i gestami na mobile.
    
4. **Zarządzanie stanem bez persystencji**: Stan quizu (batch 40 pytań) będzie przechowywany wyłącznie w pamięci operacyjnej (Pinia), bez zapisu w `localStorage`, co wymusza uczciwość rozgrywki.
    
5. **Dynamiczny Loading State**: Zamiast prostego spinnera, interfejs będzie wyświetlał rotacyjne ciekawostki i statusy procesowe podczas 40-sekundowego generowania pytań przez LLM.
    
6. **Architektura CRUD**: Zdecydowano się na wzorzec Master-Detail z wirtualizacją listy, aby umożliwić płynne zarządzanie dużą bazą pytań i szybką obsługę oflagowanych błędów.
    
7. **Anti-cheat UI**: Wprowadzenie blokady zaznaczania tekstu i menu kontekstowego podczas rundy, aby zniechęcić do kopiowania pytań do wyszukiwarek.
    
8. **Interaktywny Dashboard**: Priorytetyzacja widoku "Pending Reviews" (pytania do poprawy) oraz wykresu radarowego umiejętności.
    

</decisions>

<matched_recommendations>

1. **Optymalizacja Mobile**: Wykorzystanie `visualViewport` API do dynamicznego dostosowania wysokości scratchpadu nad klawiaturą ekranową.
    
2. **Fluid Typography**: Dynamiczne skalowanie czcionki dla długich pytań generowanych przez AI, aby uniknąć problemów z czytelnością pod presją czasu.
    
3. **System Flagowania**: Użycie szybkich Popoverów z predefiniowanymi powodami błędów (np. "halucynacja AI"), co pozwala na zgłoszenie problemu bez opuszczania przepływu sesji.
    
4. **Wizualna hierarchia weryfikacji**: Oznaczanie pytań zweryfikowanych przez użytkownika ikoną tarczy ("Verified") w odróżnieniu od surowych danych z API ("Raw").
    
5. **A11y pod presją**: Zastosowanie `aria-live="assertive"` dla ostatnich sekund timera, aby zapewnić dostępność interfejsu przy zachowaniu dynamiki gry. </matched_recommendations>
    

<ui_architecture_planning_summary> **Główne wymagania interfejsu:** Architektura musi wspierać ekstremalną wydajność i skupienie użytkownika. UI pełni rolę "sędziego", który wymusza dyscyplinę czasową (15-30s) i rzetelność samooceny. Kluczowa jest całkowita izolacja danych użytkownika, co musi być komunikowane wizualnie na każdym etapie.

**Kluczowe widoki i przepływy:**

- **Dashboard (Astro SSR):** Centrum dowodzenia z widżetami statystyk i szybkim startem.
    
- **Generation/Loading View (Vue):** Ekran "poczekalni" z dynamicznym contentem piłkarskim.
    
- **Quiz Engine (Vue Focus Mode):** Wyizolowany ekran z timerem, pytaniem i scratchpadem. Brak nawigacji bocznej.
    
- **Round Summary:** Widok porównawczy (User vs AI) z przyciskami werdyktu ("Wiedziałem" / "Nie wiedziałem").
    
- **Expert CRUD:** Zaawansowana lista z filtrowaniem statusów (flagged, needs_review, verified).
    

**Strategia integracji i zarządzania stanem:** Aplikacja wykorzystuje hybrydowy model Astro + Vue. Astro obsługuje statyczne elementy dashboardu i autoryzację (SSR), podczas gdy Vue zarządza reaktywnym silnikiem gry. Stan sesji rezyduje w Pinii; każda odpowiedź jest natychmiast wysyłana do API (`POST /attempts`), aby minimalizować ryzyko utraty danych przy awarii, mimo braku lokalnej persystencji.

**Responsywność, dostępność i bezpieczeństwo:** Interfejs jest "mobile-first" ze szczególnym uwzględnieniem ergonomii kciuka w trybie quizu. Bezpieczeństwo jest oparte na RLS Supabase, a UI potwierdza to użytkownikowi poprzez subtelne indykatory prywatności. Timer wykorzystuje wizualne i audytywne sygnały (pulsowanie koloru, ARIA updates). </ui_architecture_planning_summary>

<unresolved_issues>

1. **Kontekst wielu kart**: Należy ustalić zachowanie systemu, gdy użytkownik otworzy aplikację w dwóch kartach jednocześnie (potencjalny konflikt aktywnej sesji).
    
2. **Offline Mode**: Do rozważenia, czy interfejs powinien informować o chwilowej utracie połączenia w trakcie 20-sekundowego timera (np. pauza techniczna czy unieważnienie pytania?).
    
3. **Wsparcie dla mediów**: Szczegółowy projekt widoku pytania z załącznikiem graficznym (Supabase Storage) w ograniczonym oknie czasowym. </unresolved_issues> </conversation_summary>