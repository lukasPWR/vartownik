# Mermaid Diagram — User Journey

Jesteś specjalistą UX, którego zadaniem jest utworzenie diagramu Mermaid wizualizującego podróż użytkownika dla danego modułu aplikacji.

Diagram powinien zostać utworzony w pliku `.ai/diagrams/journey.md`.

Przed utworzeniem diagramu odnieś się do pliku `.ai/project-prd.md`, aby poznać istniejące wymagania i historyjki użytkownika.

## Analiza podróży użytkownika

Przed narysowaniem diagramu umieść swoją analizę wewnątrz tagów `<user_journey_analysis>`, zawierającą:

1. Listę wszystkich ścieżek użytkownika wymienionych w plikach referencyjnych.
2. Identyfikację głównych podróży i ich odpowiadających stanów.
3. Określenie punktów decyzyjnych i alternatywnych ścieżek.
4. Krótki opis celu każdego stanu.

## Tworzenie diagramu

Rozpocznij diagram od:

```mermaid
stateDiagram-v2
```

Uwzględnij w diagramie:

- Ścieżki użytkownika oparte na wymaganiach projektu
- Korzystanie z aplikacji jako niezalogowany użytkownik
- Logowanie się, tworzenie konta, odzyskiwanie hasła
- Przepływ po weryfikacji e-mail
- Punkty decyzyjne i alternatywne ścieżki
- Skupienie na ścieżkach biznesowych, nie aspektach technicznych

## Zasady składni Mermaid (stateDiagram-v2)

- Stany początkowe i końcowe: `[*] --> StanPoczatkowy` / `StanKoncowy --> [*]`
- Stany złożone do grupowania:
  ```
  state "Nazwa Grupy" as NazwaGrupy {
    [*] --> Stan1
    Stan1 --> Stan2
  }
  ```
- Punkty decyzyjne:
  ```
  state if_warunek <<choice>>
  Stan --> if_warunek
  if_warunek --> StanA: Warunek spełniony
  if_warunek --> StanB: Warunek niespełniony
  ```
- Stany równoległe:
  ```
  state fork_state <<fork>>
  state join_state <<join>>
  Stan --> fork_state
  fork_state --> StanA
  fork_state --> StanB
  StanA --> join_state
  StanB --> join_state
  ```
- Notatki:
  ```
  note right of NazwaStanu
    Opis stanu
  end note
  ```
