# Dokument wymagań produktu (PRD) - VARtownik

## 1. Przegląd produktu

VARtownik to aplikacja internetowa typu MVP przeznaczona dla pasjonatów piłkarskich quizów. System umożliwia trening w oparciu o specyficzną strukturę pytań znaną z profesjonalnych quizów piłkarskich. Sercem aplikacji jest silnik AI (RAG), który generuje nowe pytania na podstawie dostarczonej bazy wiedzy, oraz system VAR, który inteligentnie weryfikuje odpowiedzi użytkownika, eliminując frustrację wynikającą z drobnych literówek.

## 2. Problem użytkownika

Uczestnicy piłkarskich quizów potrzebują narzędzia, które:

- Odzwierciedla realny format pytań konkursowych.
    
- Pozwala na nielimitowany trening (generowanie pytań przez AI).
    
- Jest elastyczne w ocenie odpowiedzi (rozpoznaje synonimy i błędy w pisowni).
    
- Pozwala na szybkie zasilenie bazy wiedzy gotowymi zestawami danych w formacie cyfrowym.
    

## 3. Wymagania funkcjonalne

### 3.1. Moduł Zarządzania Bazą Danych (Tylko Admin)

- Bezpośredni import plików JSON do bazy danych aplikacji.
    
- Walidacja struktury importowanego pliku JSON pod kątem wymaganych pól (pytanie, odpowiedź, kategoria, trudność).
    
- Możliwość manualnego dodawania, edycji i usuwania rekordów z poziomu panelu administratora.
    
- Przechowywanie zdjęć dla pytań tworzonych manualnie w chmurze (np. AWS S3).
    

### 3.2. Generator Pytań AI (RAG)

- Wykorzystanie technologii RAG do generowania pytań tekstowych wyłącznie na podstawie zaimportowanej bazy JSON.
    
- Style Guide (Few-shot) w panelu Admina do definiowania tonu i trudności pytań.
    
- Mechanizm Optimistic UI: generowanie treści w tle podczas interakcji użytkownika z interfejsem.
    

### 3.3. System Weryfikacji VAR

- Dwuetapowa walidacja: najpierw algorytm Levenshteina, następnie LLM dla kontekstowej weryfikacji synonimów.
    
- Logowanie decyzji VAR w celu optymalizacji promptów i bazy wiedzy.
    

### 3.4. Silnik Quizu i System Kont

- Rejestracja i logowanie użytkowników (e-mail/hasło).
    
- Tryby gry: Szybki Trening, Pełny Quiz, Maraton oraz tryb Custom (wybor czasu i rund).
    
- System punktacji i prezentacji wyników po zakończeniu sesji.
    

## 4. Granice produktu

### 4.1. W zakresie MVP

- Interfejs webowy (desktop/mobile web).
    
- Import danych wyłącznie poprzez pliki JSON o określonej strukturze.
    
- System VAR (Levenshtein + LLM).
    
- Panel Admina do zarządzania bazą i monitorowania jakości AI.
    

### 4.2. Poza zakresem MVP

- Automatyczne parsowanie plików .pptx (obsługa manualna po stronie Admina).
    
- Tryb rywalizacji wieloosobowej (Arena).
    
- Udostępnianie quizów między profilami użytkowników.
    
- Generowanie grafik przez AI.
    

## 5. Historyjki użytkowników

### Bezpieczeństwo i Dostęp

ID: US-001 Tytuł: Rejestracja i uwierzytelnianie Opis: Jako użytkownik chcę założyć konto i bezpiecznie się logować, aby moje postępy w treningu były zapisywane. Kryteria akceptacji:

1. System umożliwia rejestrację przy użyciu unikalnego adresu e-mail.
    
2. Hasło musi spełniać podstawowe wymogi bezpieczeństwa (min. 8 znaków).
    
3. Tylko zalogowany użytkownik ma dostęp do historii swoich quizów.
    

### Zarządzanie Danymi (Admin)

ID: US-002 Tytuł: Ręczny import bazy JSON Opis: Jako administrator chcę wgrać gotowy plik JSON, aby zasilić bazę wiedzy dla silnika AI. Kryteria akceptacji:

1. Panel administratora zawiera pole do uploadu pliku .json.
    
2. System odrzuca pliki o nieprawidłowej strukturze (brak wymaganych kluczy).
    
3. Po poprawnym imporcie dane są natychmiast dostępne dla modułu RAG.
    

ID: US-003 Tytuł: Zarządzanie rekordami i indeksowanie Opis: Jako administrator chcę edytować treść pytań i wymusić aktualizację indeksu AI. Kryteria akceptacji:

1. Admin może wyszukać i edytować dowolne pytanie w bazie.
    
2. Po edycji dostępny jest przycisk Aktualizuj indeks, który odświeża bazę embeddingów dla modelu RAG.
    

### Proces Quizu i System VAR

ID: US-004 Tytuł: Rozpoczęcie treningu z AI Opis: Jako użytkownik chcę wybrać kategorię piłkarską, aby AI wygenerowało dla mnie zestaw pytań treningowych. Kryteria akceptacji:

1. Użytkownik wybiera kategorię z listy (np. Liga Angielska).
    
2. Pierwsze pytanie pojawia się w czasie poniżej 3 sekund.
    
3. Pytania są generowane w oparciu o styl zdefiniowany w Style Guide.
    

ID: US-005 Tytuł: Inteligentna weryfikacja odpowiedzi (VAR) Opis: Jako użytkownik chcę, aby system uznał moją odpowiedź, nawet jeśli popełnię literówkę lub użyję powszechnego przydomka piłkarza. Kryteria akceptacji:

1. System zalicza odpowiedź przy niskim dystansie Levenshteina.
    
2. W przypadku braku dopasowania tekstowego, LLM analizuje odpowiedź (np. akceptuje "Luluś" dla "Lewandowski", jeśli kontekst na to pozwala).
    
3. Użytkownik otrzymuje jasną informację: Bramka uznana (VAR).
    

ID: US-006 Tytuł: Reklamacja decyzji VAR Opis: Jako użytkownik chcę zgłosić błąd, gdy system niesłusznie odrzuci moją odpowiedź. Kryteria akceptacji:

1. Po błędnej odpowiedzi dostępny jest przycisk Zgłoś błąd VAR.
    
2. Zgłoszenie zapisuje treść pytania, oczekiwaną odpowiedź i propozycję użytkownika w bazie dla Admina.
    

### Customizacja sesji

ID: US-007 Tytuł: Tryb Custom Opis: Jako użytkownik chcę ustawić własny czas na odpowiedź, aby dostosować poziom trudności do swoich umiejętności. Kryteria akceptacji:

1. Użytkownik może wybrać czas (1 min lub 3 min) przed startem quizu.
    
2. Timer odlicza czas na ekranie i automatycznie przechodzi do następnego pytania po upływie limitu.
    

## 6. Metryki sukcesu

- Jakość generowania: 80% pytań AI oznaczonych przez użytkowników jako Akceptuj.
    
- Wykorzystanie AI: 60% sesji treningowych realizowanych na pytaniach wygenerowanych przez model RAG.
    
- Skuteczność walidacji: Spadek liczby manualnych zgłoszeń błędów o 40% dzięki zastosowaniu dwustopniowego VAR (Levenshtein + LLM).
    
- Wydajność: Średni czas odpowiedzi bramki VAR (LLM) poniżej 2 sekund.