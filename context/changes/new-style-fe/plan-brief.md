# Spójny jasny motyw VARtownika — krótki plan

> Pełny plan: `context/changes/new-style-fe/plan.md`  
> Badania: `context/changes/new-style-fe/research.md`

## Co i dlaczego

Wszystkie obecne widoki VARtownika otrzymają jasny, neutralny styl inspirowany Uberem. Dziś fioletowe gradienty i półprzezroczyste karty w wielu plikach omijają istniejące tokeny shadcn-vue, przez co sama zmiana CSS nie wystarczy.

## Punkt wyjścia

Aplikacja ma sześć tras: `/`, trzy ekrany auth, `/dashboard` i `/game`. Ma już Tailwind 4, shadcn-vue Button/Input/Badge/Table oraz wspólne tokeny, ale publiczne widoki i dashboard narzucają własne kolory, a Chart.js osobną fioletową paletę. Strona `/` nadal opisuje starter techniczny.

## Pożądany stan końcowy

Białe i jasnoszare powierzchnie, ciemna typografia i czarne akcje tworzą jedną hierarchię wizualną na każdej trasie. Zielony, bursztynowy i czerwony sygnalizują wyłącznie wynik, ostrzeżenie lub błąd. Strona `/` przedstawia produkt, etykiety interfejsu są po polsku, a radar ma tekstową listę aktualnych wartości.

## Kluczowe podjęte decyzje

| Decyzja            | Wybór                                                                              | Dlaczego                                                     | Źródło                    |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------- |
| Zakres widoków     | Wszystkie sześć obecnych tras i ich stany                                          | Taki jest cel zmiany; brak jeszcze stron CRUD i podsumowania | `change.md`, badania      |
| Motyw              | Jeden jasny wariant                                                                | Najbliższy wskazanej inspiracji i prostszy w utrzymaniu      | Plan, decyzja użytkownika |
| Głębokość zmian    | Kolory, typografia, powierzchnie i odstępy; zachowane układy i przepływy           | Spójny efekt bez przebudowy logiki                           | Plan, decyzja użytkownika |
| Strona `/`         | Krótka strona produktu VARtownik                                                   | Usuwa treść startera z pierwszego kontaktu                   | Plan, decyzja użytkownika |
| Kolory stanów      | Neutralna baza oraz oszczędne zielony, bursztynowy i czerwony                      | Zachowuje znaczenie wyniku, ostrzeżenia i błędu              | Plan, decyzja użytkownika |
| Wykres             | Zachowany radar z listą wartości                                                   | Dane pozostają dostępne także poza canvas                    | Plan, decyzja użytkownika |
| Język              | Widoczne etykiety Topbar i potwierdzenia e-mail po polsku                          | Usuwa dwujęzyczność obecnych ekranów                         | Plan, decyzja użytkownika |
| Architektura stylu | Tokeny shadcn-vue + przejście po lokalnych klasach; usunięcie martwych `data-mode` | Same tokeny nie obejmą licznych lokalnych kolorów            | Badania, plan             |

## Zakres

**W zakresie:** wspólne tokeny, strona startowa, auth, dashboard z wykresem i tabelą, wszystkie stany gry, focus, kontrast, responsywność oraz zwięzłe tłumaczenia etykiet.

**Poza zakresem:** nowe strony CRUD, szczegóły sesji, podsumowanie rundy, zmiany API/danych/logiki gry, przełącznik ciemnego motywu i nowy typ wykresu.

## Architektura / podejście

Jeden zestaw jasnych tokenów w `src/styles/global.css` zasila istniejące komponenty shadcn-vue i semantyczne klasy Tailwind. Astro nadal renderuje statyczne powierzchnie; Vue obsługuje formularze, tabelę, wykres i grę. Wykres odczytuje rozstrzygnięte tokeny dla Chart.js, a jego lista wartości korzysta z tych samych danych bez nowego wywołania API.

## Fazy w skrócie

| Faza                                  | Co dostarcza                                | Kluczowe ryzyko                               |
| ------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| 1. Wspólny system wizualny            | Neutralne tokeny, semantyka stanów i focus  | Niski kontrast po zmianie powierzchni         |
| 2. Strona startowa i uwierzytelnianie | Produktowa strona `/` oraz jasny auth       | Pominięte stany błędów i siły hasła           |
| 3. Dashboard i wizualizacja danych    | Jasne karty, tabela, radar i lista wartości | Kolory canvas niezależne od CSS               |
| 4. Gra i końcowy przegląd             | Spójne stany gry i kontrola wszystkich tras | Regresje w timerze, disabled i responsywności |

**Wymagania wstępne:** działająca konfiguracja projektu oraz możliwość otwarcia chronionych ekranów na koncie testowym do kontroli ręcznej.  
**Szacowany wysiłek:** około 2–4 sesje implementacyjne w czterech fazach, plus ręczna kontrola wizualna.

## Otwarte ryzyka i założenia

- Przyjęto jeden jasny motyw; `.dark` i selektory `data-mode` nie są aktywowane przez aktualny kod i mogą zostać usunięte.
- Dashboard zawiera linki do nieistniejących jeszcze stron; plan zachowuje ich obecne zachowanie i nie traktuje ich jako widoków do stylowania.
- Ręczna kontrola stanów z błędem i pustymi danymi może wymagać lokalnego konta testowego lub kontrolowanych odpowiedzi API.

## Kryteria sukcesu (podsumowanie)

- Sześć tras i ich dostępne stany są czytelne na telefonie i desktopie, także z klawiatury oraz przy ograniczonym ruchu.
- Zwykły tekst ma kontrast co najmniej 4,5:1, a duży tekst i elementy nietekstowe co najmniej 3:1; nie ma aktywnych fioletowych akcentów starego motywu.
- `npm test`, `npm run lint` i `npm run build` przechodzą; radar i lista pokazują te same wartości po zmianie dat.
