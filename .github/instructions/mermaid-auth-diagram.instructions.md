# Mermaid Diagram — Auth Architecture

Jesteś specjalistą ds. bezpieczeństwa, którego zadaniem jest utworzenie diagramu Mermaid wizualizującego przepływ autentykacji dla danego modułu aplikacji.

Diagram powinien zostać utworzony w pliku `.ai/diagrams/auth.md`.

Przed utworzeniem diagramu odnieś się do pliku `.ai/project-prd.md`, aby poznać istniejące wymagania dotyczące autentykacji.

## Analiza autentykacji

Przed narysowaniem diagramu umieść swoją analizę wewnątrz tagów `<authentication_analysis>`, zawierającą:

1. Listę wszystkich przepływów autentykacji wymienionych w plikach referencyjnych.
2. Identyfikację głównych aktorów i ich interakcji.
3. Określenie procesów weryfikacji i odświeżania tokenów.
4. Krótki opis każdego kroku autentykacji.

## Tworzenie diagramu

Rozpocznij diagram od:

```mermaid
sequenceDiagram
```

Uwzględnij w diagramie:

- Pełny cykl życia procesu autentykacji (Vue/Astro + Supabase Auth)
- Komunikację między aktorami: Przeglądarka, Middleware, Astro API, Supabase Auth
- Wyraźne punkty przekierowania i weryfikacji tokenu
- Działanie sesji po zalogowaniu i reakcję systemu na wygaśnięcie tokenu
- Proces odświeżania tokenu i ochronę przed nieautoryzowanym dostępem

## Zasady składni Mermaid (sequenceDiagram)

- Używaj `autonumber` dla przejrzystości kroków
- Zawsze deklaruj uczestników przez `participant` przed sekwencją
- Używaj poprawnych typów strzałek:
  - `->` — zwykła strzałka
  - `-->` — przerywana strzałka
  - `->>` — strzałka z pustymi grotami
  - `-->>` — przerywana strzałka z pustymi grotami
- Aktywacja i dezaktywacja:
  ```
  activate Browser
  Browser->>API: Żądanie danych
  deactivate Browser
  ```
- Ścieżki warunkowe:
  ```
  alt Autentykacja udana
    Browser->>Dashboard: Przekierowanie
  else Autentykacja nieudana
    Browser->>LoginPage: Komunikat błędu
  end
  ```
- Działania równoległe:
  ```
  par Wysyłanie e-mail
    API->>EmailService: Wyślij weryfikację
  and Aktualizacja bazy
    API->>Database: Zaktualizuj status
  end
  ```
- Notatki obejmujące wielu uczestników:
  ```
  Note over Browser,API: Opis komunikacji
  ```

## Typowe błędy do uniknięcia

- Brak deklaracji typu diagramu na początku
- Niepoprawna składnia strzałek
- Używanie niedozwolonych znaków w identyfikatorach bez cudzysłowów
- Niezbalansowane bloki warunkowe (brak `end`)
- Linie przekraczające 80 znaków
- Niepoprawne zagnieżdżanie bloków warunkowych

Po utworzeniu diagramu przejrzyj go dokładnie pod kątem błędów składniowych i wprowadź niezbędne poprawki.
