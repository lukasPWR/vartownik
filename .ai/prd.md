# Dokument wymagań produktu (PRD) - VARtownik

## 1. Przegląd produktu

VARtownik to zaawansowany symulator turniejowy klasy Ekspert, zaprojektowany dla uczestników profesjonalnych quizów piłkarskich (np. PilkarskiQuiz.pl). Aplikacja ma na celu odwzorowanie rygorystycznych warunków zawodów, kładąc nacisk na wysoką trudność merytoryczną, presję czasu oraz konieczność szybkiego przełączania kontekstów między różnymi kategoriami piłkarskimi. System opiera się na silniku AI generującym unikalne zestawy pytań oraz module symulacji wymuszającym skupienie i rzetelną samoocenę. Technologicznie projekt bazuje na frameworku Astro, bazie Supabase oraz integracji z modelami LLM poprzez Prompt Engineering.

## 2. Problem użytkownika

Uczestnicy elitarnych turniejów wiedzy piłkarskiej borykają się z brakiem dedykowanych narzędzi treningowych, które oferowałyby poziom trudności wyższy niż ogólnodostępne aplikacje mobilne. Kluczowe problemy to:

- Zbyt niskie skomplikowanie pytań w popularnych quizach.
    
- Brak treningu pod presją czasu (wymóg odpowiedzi w 15-30 sekund).
    
- Monotematyczność zestawów treningowych – użytkownicy potrzebują wymieszanych kategorii (np. statystyki obok historii polskiej piłki), aby trenować elastyczność umysłową.
    
- Brak możliwości gromadzenia własnej, zweryfikowanej bazy trudnych pytań do powtórek.
    

## 3. Wymagania funkcjonalne

### 3.1. Moduł Generowania AI (Generator)

- Generowanie kompletnej paczki 40 pytań (4 rundy po 10 pytań) w jednej sesji API w celu zapewnienia spójności i szybkości działania UI.
    
- Implementacja Few-Shot Prompting w celu wymuszenia poziomu Ekspert (wymóg min. dwóch parametrów w pytaniu, np. postać + rok + klub).
    
- Miksowanie kategorii tematycznych wewnątrz każdej rundy zgodnie ze zdefiniowanymi wagami (np. Ekstraklasa, Historia MŚ/Euro, Statystyki, Piłka zagraniczna, Reprezentacja Polski).
    
- Mechanizm Retry (maksymalnie 2 próby) w przypadku otrzymania nieprawidłowego formatu JSON z API.
    

### 3.2. Silnik Gry (Game Engine)

- Licznik czasu (Timer) per pytanie ustawiony w przedziale 15-30 sekund.
    
- Blokada wprowadzania odpowiedzi po upływie czasu.
    
- Scratchpad: Pole tekstowe dla użytkownika do wpisania roboczej odpowiedzi przed jej formalnym odkryciem.
    
- Brak funkcji pauzy oraz zapisu stanu w trakcie trwania rundy (odświeżenie strony przerywa quiz).
    
- Wyświetlanie poprawnych odpowiedzi zbiorczo dopiero po zakończeniu danej rundy (10 pytań).
    

### 3.3. System Weryfikacji i Postępu

- Model samooceny: Użytkownik samodzielnie oznacza na ekranie podsumowania rundy, czy jego odpowiedź była poprawna (Wiedziałem / Nie wiedziałem).
    
- Zapisywanie pełnej historii odpowiedzi: ID pytania, treść scratchpadu, werdykt użytkownika oraz czas reakcji.
    
- Przypisywanie difficulty_score (skala 1-5) do każdego pytania w bazie danych.
    

### 3.4. Panel Zarządzania (CRUD)

- Możliwość manualnego dodawania, edycji i usuwania pytań z własnej bazy.
    
- System flagowania: Pytania oznaczone jako błędne (np. halucynacja AI) otrzymują status flagged i są wykluczane z rotacji do czasu ręcznej korekty.
    
- Obsługa załączników binarnych (obrazków) przez Supabase Storage dla pytań dodawanych ręcznie.
    

### 3.5. Bezpieczeństwo i Architektura

- System autoryzacji oparty na Supabase Auth.
    
- Implementacja Row Level Security (RLS) od początku projektu, zapewniająca izolację danych (każdy użytkownik ma dostęp wyłącznie do swoich quizów i statystyk).
    
- Loading State: Wyświetlanie rotacyjnej listy ciekawostek piłkarskich podczas oczekiwania na wygenerowanie quizu przez AI.
    

## 4. Granice produktu

- Brak mechanizmu RAG: Aplikacja opiera się wyłącznie na wiedzy modelu LLM i Prompt Engineeringu.
    
- Brak trybu Multiplayer: Produkt jest narzędziem do treningu indywidualnego.
    
- Brak współdzielenia quizów: Baza pytań jest prywatna dla każdego użytkownika.
    
- Brak automatycznej walidacji tekstu (NLP/Regex): System ufa werdyktowi użytkownika w modelu samooceny.
    

## 5. Historyjki użytkowników

### US-001: Bezpieczny dostęp do konta

- ID: US-001
    
- Tytuł: Rejestracja i logowanie użytkownika
    
- Opis: Jako użytkownik chcę stworzyć chronione hasłem konto, aby moje statystyki i autorskie pytania nie były dostępne dla innych osób.
    
- Kryteria akceptacji:
    

1. Użytkownik może zarejestrować się za pomocą adresu e-mail i hasła.
    
2. Dane są poprawnie zapisywane w Supabase Auth.
    
3. Po wylogowaniu dostęp do panelu treningowego i bazy pytań jest zablokowany.
    
4. Użytkownik ma dostęp wyłącznie do rekordów powiązanych z jego user_id (RLS).
    

### US-002: Generowanie sesji treningowej

- ID: US-002
    
- Tytuł: Tworzenie zestawu 40 pytań przez AI
    
- Opis: Jako gracz chcę wygenerować pełny zestaw 40 trudnych pytań jednym kliknięciem, aby móc przejść przez pełny cykl turniejowy bez przerw na ładowanie danych.
    
- Kryteria akceptacji:
    

1. System wysyła jeden prompt do modelu AI.
    
2. AI zwraca 40 pytań podzielonych na 4 rundy.
    
3. W każdej rundzie kategorie tematyczne są wymieszane.
    
4. Podczas generowania widoczny jest ekran ładowania z ciekawostkami.
    
5. Proces trwa nie dłużej niż 40 sekund.
    

### US-003: Przebieg rundy pod presją

- ID: US-003
    
- Tytuł: Obsługa pytania z timerem
    
- Opis: Jako gracz chcę, aby każde pytanie miało odliczany czas i pole scratchpadu, aby symulować stres związany z pisaniem odpowiedzi na kartce podczas turnieju.
    
- Kryteria akceptacji:
    

1. Po wyświetleniu pytania timer startuje automatycznie (domyślnie 20s).
    
2. Użytkownik może wpisać tekst w scratchpad.
    
3. Po upływie czasu pole edycji zostaje zablokowane.
    
4. Brak przycisku pauzy na ekranie gry.
    
5. Prawidłowa odpowiedź pozostaje ukryta do końca rundy.
    

### US-004: Samoocena i weryfikacja

- ID: US-004
    
- Tytuł: Podsumowanie rundy i weryfikacja wyników
    
- Opis: Jako gracz chcę zobaczyć poprawne odpowiedzi po zakończeniu rundy i samodzielnie oznaczyć swój sukces lub porażkę, aby rzetelnie ocenić stan swojej wiedzy.
    
- Kryteria akceptacji:
    

1. Ekran podsumowania wyświetla listę 10 pytań z rundy wraz z odpowiedziami AI oraz notatkami użytkownika ze scratchpadu.
    
2. Przy każdym pytaniu znajdują się dwa przyciski: Wiedziałem oraz Nie wiedziałem.
    
3. Wynik punktowy rundy jest aktualizowany na podstawie kliknięć.
    
4. Przejście do kolejnej rundy jest możliwe dopiero po oznaczeniu wszystkich 10 pytań.
    

### US-005: Zarządzanie jakością bazy

- ID: US-005
    
- Tytuł: Flagowanie i edycja błędnych pytań
    
- Opis: Jako użytkownik chcę mieć możliwość poprawienia błędu w pytaniu wygenerowanym przez AI, aby moja baza treningowa nie zawierała nieprawdy.
    
- Kryteria akceptacji:
    

1. Użytkownik może oflagować pytanie jako błędne na ekranie podsumowania.
    
2. Oflagowane pytania pojawiają się w dedykowanej zakładce w panelu CRUD.
    
3. Użytkownik może ręcznie edytować treść pytania, odpowiedzi oraz kategorię.
    
4. Pytanie ze statusem flagged nie jest losowane do przyszłych quizów, dopóki status nie zostanie zmieniony na zweryfikowany.
    

### US-006: Analiza postępów

- ID: US-006
    
- Tytuł: Przegląd historii i statystyk
    
- Opis: Jako gracz chcę widzieć swoją skuteczność w poszczególnych kategoriach, aby wiedzieć, jakie obszary wiedzy wymagają dodatkowego doczytania.
    
- Kryteria akceptacji:
    

1. Dashboard wyświetla ogólny procent poprawnych odpowiedzi (na podstawie modelu samooceny).
    
2. System prezentuje wykres lub listę skuteczności z podziałem na zdefiniowane kategorie tematyczne.
    
3. Użytkownik widzi listę ostatnich 10 sesji treningowych z ich wynikami.
    

### US-007: Obsługa skrajnych przypadków (Przerwanie gry)

- ID: US-007
    
- Tytuł: Reakcja na odświeżenie strony
    
- Opis: Jako twórca systemu chcę, aby odświeżenie strony unieważniało trwającą rundę, co zapobiega oszukiwaniu poprzez resetowanie timera.
    
- Kryteria akceptacji:
    

1. W trakcie aktywnej rundy nie jest zapisywany stan tymczasowy w LocalStorage/DB.
    
2. Odświeżenie strony skutkuje powrotem do ekranu głównego (Dashboardu).
    
3. Wyniki z niedokończonej rundy nie są wliczane do statystyk ogólnych.
    

## 6. Metryki sukcesu

- AI Quality: Minimum 80% pytań generowanych przez AI musi zawierać co najmniej dwa parametry identyfikujące (np. nazwisko i rok), co potwierdza poziom Ekspert.
    
- Performance: Czas od kliknięcia "Generuj" do wyświetlenia pierwszego pytania nie przekracza 40 sekund.
    
- Stability: Wskaźnik błędów parsowania JSON z AI poniżej 5% przy zastosowaniu mechanizmu Retry.
    
- Engagement: Średnia liczba ukończonych pełnych quizów (40 pytań) przez aktywnego użytkownika wynosi minimum 3 tygodniowo.
    
- Data Integrity: Brak wycieków danych między użytkownikami dzięki poprawnej konfiguracji RLS w Supabase (0 zgłoszeń naruszenia prywatności).