# Mermaid Diagram — UI Architecture

Jesteś doświadczonym architektem oprogramowania, którego zadaniem jest utworzenie diagramu Mermaid wizualizującego architekturę stron Astro i komponentów Vue dla danego modułu aplikacji.

Diagram powinien zostać utworzony w pliku `.ai/diagrams/ui.md`.

Przed utworzeniem diagramu odnieś się do pliku `.ai/project-prd.md`, aby poznać istniejące wymagania i komponenty.

## Analiza architektury

Przed narysowaniem diagramu umieść swoją analizę wewnątrz tagów `<architecture_analysis>`, zawierającą:

1. Listę wszystkich komponentów wymienionych w plikach referencyjnych.
2. Identyfikację głównych stron i ich odpowiadających komponentów.
3. Określenie przepływu danych między komponentami.
4. Krótki opis funkcjonalności każdego komponentu.

## Tworzenie diagramu

Rozpocznij diagram od:

```mermaid
flowchart TD
```

Uwzględnij w diagramie:

- Strukturę UI z layoutami, stronami serwerowymi i komponentami
- Grupowanie elementów według funkcjonalności
- Kierunek przepływu danych między komponentami
- Moduły odpowiedzialne za stan aplikacji
- Podział na komponenty współdzielone i specyficzne dla stron
- Zależności między komponentami autentykacji a resztą aplikacji
- Wyróżnienie komponentów wymagających aktualizacji

## Zasady składni Mermaid

- Używaj spójnego formatowania ID węzłów (unikalne, bez spacji)
- Używaj poprawnych kształtów węzłów:
  - `[Tekst]` — prostokąt
  - `(Tekst)` — zaokrąglony prostokąt
  - `((Tekst))` — okrąg
  - `{Tekst}` — romb
  - `[[Tekst]]` — podprogram
- Grupuj powiązane elementy za pomocą `subgraph`/`end`
- Używaj poprawnych typów połączeń: `-->`, `---`, `-.->`, `==>`, `--Tekst-->`
- Używaj cudzysłowów dla tekstu zawierającego spacje: `A["Komponent"]`
- Unikaj adresów URL, nawiasów i złożonych wyrażeń w nazwach węzłów
- Używaj `classDef` i `:::styleClass` dla stylizacji węzłów

## Typowe błędy do uniknięcia

- Brak deklaracji typu diagramu na początku
- Nieprawidłowe ID węzłów (z niedozwolonymi znakami)
- Niezamknięte subgrafy (brak `end`)
- Niespójne kierunki przepływu (mieszanie `TD` i `LR` bez uzasadnienia)
