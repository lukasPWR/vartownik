Jako starszy programista frontendu Twoim zadaniem jest stworzenie szczegółowego planu wdrożenia nowego widoku w aplikacji internetowej. Plan ten powinien być kompleksowy i wystarczająco jasny dla innego programisty frontendowego, aby mógł poprawnie i wydajnie wdrożyć widok.

Najpierw przejrzyj następujące informacje:

1. Product Requirements Document (PRD):
   <prd>
   #file:../../.ai/prd.md
   </prd>

2. Opis widoku:
   <view_description>

### 2.4. Dashboard

- **Ścieżka:** `/dashboard`
- **Główny cel:** Centrum dowodzenia — przegląd statystyk, szybki start quizu, lista oczekujących recenzji.
- **Kluczowe informacje:**
  - Ogólna skuteczność (% poprawnych odpowiedzi)
  - Liczba ukończonych sesji
  - Liczba oflagowanych pytań oczekujących na przegląd
  - Lista ostatnich 10 sesji z wynikami
  - Skuteczność per kategoria (wykres radarowy)
- **Kluczowe komponenty:**
  - **Widżet „Szybki start"** — przycisk „Generuj Quiz" uruchamiający generowanie nowej sesji
  - **Widżet statystyk ogólnych** — karty z liczbami (łączne próby, skuteczność, sesje)
  - **Widżet „Pending Reviews"** — lista oflagowanych pytań z szybkim linkiem do edycji
  - **Wykres radarowy kategorii** — wizualizacja skuteczności per kategoria tematyczna (Vue island)
  - **Lista ostatnich sesji** — tabela z datą, wynikiem, statusem i linkiem do szczegółów
- **UX / Dostępność / Bezpieczeństwo:**
  - Renderowanie SSR (Astro) — szybki czas pierwszego malowania
  - Widżety interaktywne jako Vue islands (wykres, lista sesji z paginacją)
  - Subtelny indykator prywatności danych (ikona kłódki z tooltipem „Tylko Twoje dane")
  - Responsywny grid: 2 kolumny na desktop, 1 kolumna na mobile
  - Dane ładowane server-side (brak flickeringu)
- **Mapowanie API:** `GET /api/stats/overview`, `GET /api/stats/categories`, `GET /api/sessions`
- **Mapowanie US:** US-006

---

</view_description>

3. User Stories:
   <user_stories>

### US-006: Analiza postępów

- ID: US-006
- Tytuł: Przegląd historii i statystyk
- Opis: Jako gracz chcę widzieć swoją skuteczność w poszczególnych kategoriach, aby wiedzieć, jakie obszary wiedzy wymagają dodatkowego doczytania.
- Kryteria akceptacji:

1. Dashboard wyświetla ogólny procent poprawnych odpowiedzi (na podstawie modelu samooceny).
2. System prezentuje wykres lub listę skuteczności z podziałem na zdefiniowane kategorie tematyczne.
3. Użytkownik widzi listę ostatnich 10 sesji treningowych z ich wynikami.

   </user_stories>

4. Endpoint Description:
   <endpoint_description>

#### `GET /api/stats/overview`

Overall user performance summary for dashboard (US-006).

**Response `200`:**

```json
{
  "total_attempts": 1240,
  "knew_count": 867,
  "did_not_know_count": 373,
  "overall_accuracy_percent": 69.9,
  "total_sessions_completed": 31,
  "flagged_questions_pending": 4
}
```

---

#### `GET /api/stats/categories`

Per-category effectiveness breakdown (US-006).

**Query params:** `from` (date, default 30 days ago), `to` (date, default today)

**Response `200`:**

```json
{
  "data": [
    {
      "category_id": "uuid",
      "category_name": "Ekstraklasa",
      "attempts_count": 320,
      "knew_count": 210,
      "did_not_know_count": 110,
      "accuracy_percent": 65.6
    }
  ]
}
```

#### `GET /api/sessions`

List past sessions for dashboard (US-006).

**Query params:** `page`, `limit`, `status` (`in_progress | completed | abandoned`)

**Response `200`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "status": "completed",
      "timer_seconds": 20,
      "total_rounds": 4,
      "questions_per_round": 10,
      "started_at": "2026-03-21T10:00:00Z",
      "completed_at": "2026-03-21T10:25:00Z",
      "score_summary": {
        "total_questions": 40,
        "knew_count": 28,
        "did_not_know_count": 12,
        "accuracy_percent": 70
      }
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 23 }
}
```

---

</endpoint_description>

7. Type Definitions:
   <type_definitions>
   #file:../../src/types.ts
   </type_definitions>

8. Tech Stack:
   <tech_stack>
   #file:../../.ai/tech-stack.md
   </tech_stack>

Przed utworzeniem ostatecznego planu wdrożenia przeprowadź analizę i planowanie wewnątrz tagów <implementation_breakdown> w swoim bloku myślenia. Ta sekcja może być dość długa, ponieważ ważne jest, aby być dokładnym.

W swoim podziale implementacji wykonaj następujące kroki:

1. Dla każdej sekcji wejściowej (PRD, User Stories, Endpoint Description, Endpoint Implementation, Type Definitions, Tech Stack):

- Podsumuj kluczowe punkty
- Wymień wszelkie wymagania lub ograniczenia
- Zwróć uwagę na wszelkie potencjalne wyzwania lub ważne kwestie

2. Wyodrębnienie i wypisanie kluczowych wymagań z PRD
3. Wypisanie wszystkich potrzebnych głównych komponentów, wraz z krótkim opisem ich opisu, potrzebnych typów, obsługiwanych zdarzeń i warunków walidacji
4. Stworzenie wysokopoziomowego diagramu drzewa komponentów
5. Zidentyfikuj wymagane DTO i niestandardowe typy ViewModel dla każdego komponentu widoku. Szczegółowo wyjaśnij te nowe typy, dzieląc ich pola i powiązane typy.
6. Zidentyfikuj potencjalne zmienne stanu i niestandardowe hooki, wyjaśniając ich cel i sposób ich użycia
7. Wymień wymagane wywołania API i odpowiadające im akcje frontendowe
8. Zmapuj każdej historii użytkownika do konkretnych szczegółów implementacji, komponentów lub funkcji
9. Wymień interakcje użytkownika i ich oczekiwane wyniki
10. Wymień warunki wymagane przez API i jak je weryfikować na poziomie komponentów
11. Zidentyfikuj potencjalne scenariusze błędów i zasugeruj, jak sobie z nimi poradzić
12. Wymień potencjalne wyzwania związane z wdrożeniem tego widoku i zasugeruj możliwe rozwiązania

Po przeprowadzeniu analizy dostarcz plan wdrożenia w formacie Markdown z następującymi sekcjami:

1. Przegląd: Krótkie podsumowanie widoku i jego celu.
2. Routing widoku: Określenie ścieżki, na której widok powinien być dostępny.
3. Struktura komponentów: Zarys głównych komponentów i ich hierarchii.
4. Szczegóły komponentu: Dla każdego komponentu należy opisać:

- Opis komponentu, jego przeznaczenie i z czego się składa
- Główne elementy HTML i komponenty dzieci, które budują komponent
- Obsługiwane zdarzenia
- Warunki walidacji (szczegółowe warunki, zgodnie z API)
- Typy (DTO i ViewModel) wymagane przez komponent
- Propsy, które komponent przyjmuje od rodzica (interfejs komponentu)

5. Typy: Szczegółowy opis typów wymaganych do implementacji widoku, w tym dokładny podział wszelkich nowych typów lub modeli widoku według pól i typów.
6. Zarządzanie stanem: Szczegółowy opis sposobu zarządzania stanem w widoku, określenie, czy wymagany jest customowy hook.
7. Integracja API: Wyjaśnienie sposobu integracji z dostarczonym punktem końcowym. Precyzyjnie wskazuje typy żądania i odpowiedzi.
8. Interakcje użytkownika: Szczegółowy opis interakcji użytkownika i sposobu ich obsługi.
9. Warunki i walidacja: Opisz jakie warunki są weryfikowane przez interfejs, których komponentów dotyczą i jak wpływają one na stan interfejsu
10. Obsługa błędów: Opis sposobu obsługi potencjalnych błędów lub przypadków brzegowych.
11. Kroki implementacji: Przewodnik krok po kroku dotyczący implementacji widoku.

Upewnij się, że Twój plan jest zgodny z PRD, historyjkami użytkownika i uwzględnia dostarczony stack technologiczny.

Ostateczne wyniki powinny być w języku polskim i zapisane w pliku o nazwie .ai/{module-name}/{view-name}-view-implementation-plan.md. Nie uwzględniaj żadnej analizy i planowania w końcowym wyniku.

Oto przykład tego, jak powinien wyglądać plik wyjściowy (treść jest do zastąpienia):

```markdown
# Plan implementacji widoku [Nazwa widoku]

## 1. Przegląd

[Krótki opis widoku i jego celu]

## 2. Routing widoku

[Ścieżka, na której widok powinien być dostępny]

## 3. Struktura komponentów

[Zarys głównych komponentów i ich hierarchii]

## 4. Szczegóły komponentów

### [Nazwa komponentu 1]

- Opis komponentu [opis]
- Główne elementy: [opis]
- Obsługiwane interakcje: [lista]
- Obsługiwana walidacja: [lista, szczegółowa]
- Typy: [lista]
- Propsy: [lista]

### [Nazwa komponentu 2]

[...]

## 5. Typy

[Szczegółowy opis wymaganych typów]

## 6. Zarządzanie stanem

[Opis zarządzania stanem w widoku]

## 7. Integracja API

[Wyjaśnienie integracji z dostarczonym endpointem, wskazanie typów żądania i odpowiedzi]

## 8. Interakcje użytkownika

[Szczegółowy opis interakcji użytkownika]

## 9. Warunki i walidacja

[Szczegółowy opis warunków i ich walidacji]

## 10. Obsługa błędów

[Opis obsługi potencjalnych błędów]

## 11. Kroki implementacji

1. [Krok 1]
2. [Krok 2]
3. [...]
```

Rozpocznij analizę i planowanie już teraz. Twój ostateczny wynik powinien składać się wyłącznie z planu wdrożenia w języku polskim w formacie markdown, który zapiszesz w pliku .ai/{module-name}/{view-name}-view-implementation-plan.md i nie powinien powielać ani powtarzać żadnej pracy wykonanej w podziale implementacji.
