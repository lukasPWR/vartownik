# Plan implementacji widoku Auth (Logowanie i Rejestracja)

## 1. Przegląd

Widok Auth obejmuje dwa ekrany: logowania (`/auth/signin`) i rejestracji (`/auth/signup`). Ich zadaniem jest bezpieczne uwierzytelnienie użytkownika przy pomocy Supabase Auth z sesjami opartymi na HttpOnly cookie (SSR). Strony są renderowane server-side przez Astro, natomiast interaktywna logika formularzy (walidacja inline, obsługa stanu, wskaźnik siły hasła) jest zrealizowana jako Vue 3 islands (`client:load`). Każdy formularz komunikuje się z istniejącymi endpointami API (`/api/auth/signin`, `/api/auth/signup`) przez `fetch` z `FormData`.

---

## 2. Routing widoku

| Widok | Ścieżka | Plik Astro |
|---|---|---|
| Logowanie | `/auth/signin` | `src/pages/auth/signin.astro` |
| Rejestracja | `/auth/signup` | `src/pages/auth/signup.astro` |
| Potwierdzenie e-mail | `/auth/confirm-email` | `src/pages/auth/confirm-email.astro` (istniejący) |

Middleware (`src/middleware.ts`) musi obsługiwać przekierowanie zalogowanych użytkowników próbujących wejść na `/auth/*` — do `/dashboard`. Chronione trasy, które wymagają sesji, przekierowują niezalogowanych użytkowników na `/auth/signin`.

---

## 3. Struktura komponentów

```
signin.astro
└── SignInForm.vue  [client:load]
    ├── <FormField> (e-mail)
    ├── <FormField> (hasło)
    └── <ErrorAlert> (błąd serwera)

signup.astro
└── SignUpForm.vue  [client:load]
    ├── <FormField> (e-mail)
    ├── <FormField> (hasło)
    ├── <PasswordStrengthIndicator>
    ├── <FormField> (potwierdzenie hasła)
    └── <ErrorAlert> (błąd serwera)
```

`FormField` i `ErrorAlert` są komponentami wewnętrznymi (zdefiniowanymi wewnątrz pliku `.vue` lub jako osobne pliki w `src/components/auth/`).

---

## 4. Szczegóły komponentów

### `signin.astro`

- **Opis:** Astro page — szkielet strony logowania. Renderuje layout, tło, nagłówek i osadza Vue island `SignInForm`. Nie czyta już `?error` z URL — obsługę błędów przejmuje Vue.
- **Główne elementy HTML:** `<Layout>`, kontener centralny z gradientem, `<SignInForm client:load />`, link do `/auth/signup`.
- **Obsługiwane interakcje:** brak bezpośrednich — delegowane do Vue island.
- **Walidacja:** brak po stronie Astro.
- **Typy:** brak.
- **Propsy:** brak.

---

### `signup.astro`

- **Opis:** Astro page — szkielet strony rejestracji. Identyczna struktura wizualna jak `signin.astro`. Osadza Vue island `SignUpForm`.
- **Główne elementy HTML:** `<Layout>`, kontener centralny, `<SignUpForm client:load />`, link do `/auth/signin`.
- **Obsługiwane interakcje:** brak.
- **Walidacja:** brak.
- **Typy:** brak.
- **Propsy:** brak.

---

### `SignInForm.vue`

- **Opis:** Interaktywny formularz logowania. Obsługuje lokalny stan pól, walidację inline, wysyłkę przez `fetch` i wyświetlanie błędów serwera bez przeładowania strony. Po pomyślnym zalogowaniu przekierowuje użytkownika przez `window.location.href`.
- **Główne elementy:**
  - `<form @submit.prevent="handleSubmit">`
  - `<FormField>` dla e-mail — `type="email"`, `autocomplete="email"`, `autofocus`
  - `<FormField>` dla hasła — `type="password"`, `autocomplete="current-password"`
  - `<ErrorAlert>` — wyświetlany warunkowo gdy `serverError` jest ustawiony
  - `<Button type="submit" :disabled="isSubmitting">` z shadcn-vue
  - Link do `/auth/signup`
- **Obsługiwane zdarzenia:**
  - `submit` formularza → `handleSubmit()`
  - `input` / `blur` na polach → walidacja inline (`validateEmail()`, `validatePassword()`)
- **Warunki walidacji:**
  - `email`: wymagany, musi pasować do formatu RFC 5322 (test przez `input[type=email]` lub regex `/.+@.+\..+/`)
  - `password`: wymagany, minimalna długość 6 znaków (limit Supabase Auth)
  - Formularz blokuje submit jeśli którykolwiek z warunków nie jest spełniony
- **Typy:** `SignInFormState`, `SignInFormErrors`
- **Propsy:** brak (komponent samodzielny)

---

### `SignUpForm.vue`

- **Opis:** Interaktywny formularz rejestracji z trzema polami, wskaźnikiem siły hasła i walidacją zgodności pól. Po pomyślnej rejestracji przekierowuje na `/auth/confirm-email`.
- **Główne elementy:**
  - `<form @submit.prevent="handleSubmit">`
  - `<FormField>` dla e-mail — `type="email"`, `autocomplete="email"`, `autofocus`
  - `<FormField>` dla hasła — `type="password"`, `autocomplete="new-password"`
  - `<PasswordStrengthIndicator :strength="passwordStrength" />` — wyświetlany pod polem hasła gdy hasło jest niepuste
  - `<FormField>` dla potwierdzenia hasła — `type="password"`, `autocomplete="new-password"`
  - `<ErrorAlert>` — wyświetlany warunkowo
  - `<Button type="submit" :disabled="isSubmitting">`
  - Link do `/auth/signin`
- **Obsługiwane zdarzenia:**
  - `submit` → `handleSubmit()`
  - `input` / `blur` na polach → walidacja inline
- **Warunki walidacji:**
  - `email`: wymagany, format e-mail
  - `password`: wymagany, min. 8 znaków (wyższy próg UX niż minimum Supabase)
  - `confirmPassword`: wymagany, musi być identyczny z `password`
  - Formularz blokuje submit jeśli warunki nie są spełnione
- **Typy:** `SignUpFormState`, `SignUpFormErrors`, `PasswordStrength`
- **Propsy:** brak

---

### `FormField` (komponent wewnętrzny)

- **Opis:** Atom — opakowuje `<label>`, `<Input>` (shadcn-vue) i komunikat błędu inline. Zapewnia spójny wygląd i dostępność wszystkich pól formularza.
- **Główne elementy:** `<div>`, `<label :for="id">`, `<Input v-bind="$attrs" :id="id" :aria-describedby="errorId">`, `<p :id="errorId" role="alert" v-if="error">{{ error }}</p>`
- **Obsługiwane zdarzenia:** przechwytuje i re-emituje `update:modelValue` (v-model), `blur`
- **Walidacja:** brak wewnętrznej walidacji — wyświetla `error` przekazany jako props
- **Typy:** brak dodatkowych
- **Propsy:**
  - `id: string` — id pola (powiązanie z label)
  - `label: string` — tekst etykiety
  - `modelValue: string` — wartość pola (v-model)
  - `type?: string` — typ inputa, domyślnie `'text'`
  - `error?: string` — komunikat błędu; gdy ustawiony, input dostaje styl błędu
  - `autocomplete?: string`

---

### `PasswordStrengthIndicator` (komponent wewnętrzny)

- **Opis:** Wizualny wskaźnik siły hasła — pasek z 3 segmentami i etykietą słowną (Słabe / Średnie / Silne). Bezstanowy komponent prezentacyjny.
- **Główne elementy:** `<div>` z 3 segmentami `<span>` kolorowanymi na podstawie `strength` + `<p>` z etykietą
- **Obsługiwane zdarzenia:** brak
- **Walidacja:** brak (tylko prezentacja)
- **Typy:** `PasswordStrength`
- **Propsy:**
  - `strength: PasswordStrength` — wartość `'empty' | 'weak' | 'medium' | 'strong'`

---

### `ErrorAlert` (komponent wewnętrzny)

- **Opis:** Alert wyświetlający błąd zwrócony przez serwer (np. nieprawidłowe hasło, konto nieistniejące). Renderowany warunkowo (`v-if`).
- **Główne elementy:** `<div role="alert" aria-live="assertive">` z ikoną błędu i tekstem
- **Obsługiwane zdarzenia:** brak
- **Typy:** brak
- **Propsy:**
  - `message: string` — treść komunikatu błędu

---

## 5. Typy

Wszystkie poniższe typy są lokalne dla komponentów auth — nie trafiają do `src/types.ts` (nie są to typy API).

```ts
// src/components/auth/types.ts

/** Stan pól formularza logowania */
interface SignInFormState {
  email: string;
  password: string;
}

/** Błędy walidacji formularza logowania */
interface SignInFormErrors {
  email?: string;
  password?: string;
  server?: string;
}

/** Stan pól formularza rejestracji */
interface SignUpFormState {
  email: string;
  password: string;
  confirmPassword: string;
}

/** Błędy walidacji formularza rejestracji */
interface SignUpFormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  server?: string;
}

/** Siła hasła obliczana po stronie klienta */
type PasswordStrength = 'empty' | 'weak' | 'medium' | 'strong';
```

Reguły obliczania `PasswordStrength` (czysta funkcja `computePasswordStrength(password: string): PasswordStrength`):
- `'empty'` — długość 0
- `'weak'` — długość 1–7 lub zawiera tylko jeden typ znaków
- `'medium'` — długość ≥ 8 + co najmniej 2 typy znaków (małe litery, wielkie litery, cyfry, znaki specjalne)
- `'strong'` — długość ≥ 10 + co najmniej 3 typy znaków

---

## 6. Zarządzanie stanem

Oba formularze używają **lokalnego stanu reaktywnego Vue** zdefiniowanego bezpośrednio w `<script setup>` za pomocą `ref` / `reactive`. Nie jest wymagany store Nano Stores — dane uwierzytelnienia są ulotne i nie są współdzielone między wyspami.

**Stan `SignInForm.vue`:**
```ts
const form = reactive<SignInFormState>({ email: '', password: '' });
const errors = reactive<SignInFormErrors>({});
const isSubmitting = ref(false);
```

**Stan `SignUpForm.vue`:**
```ts
const form = reactive<SignUpFormState>({ email: '', password: '', confirmPassword: '' });
const errors = reactive<SignUpFormErrors>({});
const isSubmitting = ref(false);
const passwordStrength = computed<PasswordStrength>(() => computePasswordStrength(form.password));
```

Walidacja jest uruchamiana:
- **`blur`** na polu → walidacja tylko tego pola (wczesne ostrzeżenie)
- **`submit`** → pełna walidacja wszystkich pól przed wysyłką

---

## 7. Integracja API

### `POST /api/auth/signin`

- **Żądanie:** `FormData` z polami `email` i `password`
- **Odpowiedź sukcesu:** redirect 302 na `/` (Astro ustawia HttpOnly session cookie)
- **Odpowiedź błędu:** redirect 302 na `/auth/signin?error=<message>`

**Mechanizm obsługi w Vue (`fetch` z `redirect: 'follow'`):**

```ts
const handleSubmit = async () => {
  if (!validateAll()) return;
  isSubmitting.value = true;
  errors.server = undefined;

  const formData = new FormData();
  formData.set('email', form.email);
  formData.set('password', form.password);

  try {
    const response = await fetch('/api/auth/signin', {
      method: 'POST',
      body: formData,
    });

    const finalUrl = new URL(response.url);
    const errorMsg = finalUrl.searchParams.get('error');

    if (errorMsg) {
      errors.server = errorMsg;
    } else {
      window.location.href = '/dashboard';
    }
  } catch {
    errors.server = 'Wystąpił błąd sieci. Spróbuj ponownie.';
  } finally {
    isSubmitting.value = false;
  }
};
```

> **Uwaga:** `fetch` domyślnie (`redirect: 'follow'`) śledzi przekierowania i udostępnia `response.url` jako finalny URL. Jeśli zawiera `?error=`, wyświetlamy błąd inline. Jeśli nie, przekierowujemy na `/dashboard`.

### `POST /api/auth/signup`

- **Żądanie:** `FormData` z polami `email` i `password` (pole `confirmPassword` nie jest wysyłane — jest wyłącznie walidacją front-endową)
- **Odpowiedź sukcesu:** redirect 302 na `/auth/confirm-email`
- **Odpowiedź błędu:** redirect 302 na `/auth/signup?error=<message>`

Analogiczna logika `fetch` jak wyżej. Po sukcesie: `window.location.href = '/auth/confirm-email'`.

---

## 8. Interakcje użytkownika

| Interakcja | Komponent | Efekt |
|---|---|---|
| Wpisanie e-mail, opuszczenie pola (`blur`) | `SignInForm`, `SignUpForm` | Walidacja formatu e-mail; wyświetlenie błędu inline jeśli niepoprawny |
| Wpisanie hasła, opuszczenie pola (`blur`) | `SignInForm` | Walidacja minimalnej długości hasła |
| Wpisanie hasła (każdy znak) | `SignUpForm` | Aktualizacja `passwordStrength` → odświeżenie `PasswordStrengthIndicator` |
| Wpisanie hasła, opuszczenie pola (`blur`) | `SignUpForm` | Walidacja min. 8 znaków |
| Wpisanie potwierdzenia hasła, `blur` | `SignUpForm` | Walidacja zgodności z hasłem |
| Klik „Zaloguj się" / `submit` | `SignInForm` | Pełna walidacja → `fetch POST /api/auth/signin` → redirect lub błąd |
| Klik „Zarejestruj się" / `submit` | `SignUpForm` | Pełna walidacja → `fetch POST /api/auth/signup` → redirect lub błąd |
| Klik linku „Zarejestruj się" | `SignInForm`, `signin.astro` | Nawigacja do `/auth/signup` (standardowy link) |
| Klik linku „Zaloguj się" | `SignUpForm`, `signup.astro` | Nawigacja do `/auth/signin` (standardowy link) |
| Oczekiwanie na odpowiedź serwera | `SignInForm`, `SignUpForm` | Przycisk `submit` staje się `disabled`, opcjonalnie spinner |

---

## 9. Warunki i walidacja

### Formularz logowania (`SignInForm.vue`)

| Pole | Warunek | Komunikat błędu |
|---|---|---|
| `email` | Pole niepuste | „E-mail jest wymagany" |
| `email` | Poprawny format RFC 5322 | „Podaj poprawny adres e-mail" |
| `password` | Pole niepuste | „Hasło jest wymagane" |
| `password` | Długość ≥ 6 znaków | „Hasło musi mieć co najmniej 6 znaków" |
| Formularz | Brak błędów walidacji | submit zablokowany |

### Formularz rejestracji (`SignUpForm.vue`)

| Pole | Warunek | Komunikat błędu |
|---|---|---|
| `email` | Pole niepuste | „E-mail jest wymagany" |
| `email` | Poprawny format | „Podaj poprawny adres e-mail" |
| `password` | Pole niepuste | „Hasło jest wymagane" |
| `password` | Długość ≥ 8 znaków | „Hasło musi mieć co najmniej 8 znaków" |
| `confirmPassword` | Pole niepuste | „Potwierdzenie hasła jest wymagane" |
| `confirmPassword` | Identyczne z `password` | „Hasła nie są identyczne" |
| Formularz | Brak błędów walidacji | submit zablokowany |

### Warunki dostępności

- Pola wymagają jawnych `<label>` powiązanych przez `for/id`
- Komunikaty błędów połączone z polem przez `aria-describedby`
- `<ErrorAlert>` z `role="alert"` i `aria-live="assertive"` dla błędów serwera
- Autofocus na polu e-mail przy montowaniu komponentu (`onMounted` + `el.focus()` lub `autofocus`)

---

## 10. Obsługa błędów

| Scenariusz | Źródło | Obsługa UI |
|---|---|---|
| Nieprawidłowy e-mail lub hasło | Supabase Auth → API redirect `?error=` | `errors.server` → `<ErrorAlert>` z komunikatem |
| Konto nieistniejące | Supabase Auth → API redirect `?error=` | j.w. |
| Konto zablokowane / nieaktywne | Supabase Auth → API redirect `?error=` | j.w. |
| E-mail już zajęty (rejestracja) | Supabase Auth → API redirect `?error=` | j.w. |
| Limit prób (rate limiting) | Supabase Auth → API redirect `?error=` | j.w. |
| Błąd sieci (`fetch` rzuca wyjątek) | `catch` blok w `handleSubmit` | `errors.server = 'Błąd sieci. Spróbuj ponownie.'` |
| Nieoczekiwana odpowiedź bez `?error` i bez redirect na dashboard | Fallback | `errors.server = 'Nieoczekiwany błąd. Spróbuj ponownie.'` |

Komunikaty błędów z Supabase Auth są w języku angielskim (np. `"Invalid login credentials"`). Można dodać mapowanie na polskie komunikaty w `SignInForm.vue` / `SignUpForm.vue`:

```ts
const AUTH_ERROR_MAP: Record<string, string> = {
  'Invalid login credentials': 'Nieprawidłowy e-mail lub hasło',
  'Email not confirmed': 'Potwierdź adres e-mail przed zalogowaniem',
  'User already registered': 'Konto z tym adresem e-mail już istnieje',
  'Password should be at least 6 characters': 'Hasło musi mieć co najmniej 6 znaków',
};

const translateError = (msg: string): string => AUTH_ERROR_MAP[msg] ?? msg;
```

---

## 11. Kroki implementacji

1. **Utwórz plik typów lokalnych** `src/components/auth/types.ts` z interfejsami `SignInFormState`, `SignInFormErrors`, `SignUpFormState`, `SignUpFormErrors` oraz typem `PasswordStrength`.

2. **Utwórz funkcję pomocniczą** `computePasswordStrength(password: string): PasswordStrength` w `src/components/auth/types.ts` lub `src/lib/utils.ts`.

3. **Utwórz `PasswordStrengthIndicator.vue`** w `src/components/auth/`:
   - Przyjmuje props `strength: PasswordStrength`
   - Renderuje 3 segmenty i etykietę słowną

4. **Utwórz `SignInForm.vue`** w `src/components/auth/`:
   - Zaimportuj typy i shadcn-vue `Button`, `Input`
   - Zdefiniuj reaktywny stan (`form`, `errors`, `isSubmitting`)
   - Zaimplementuj walidację pól (`validateEmail`, `validatePassword`, `validateAll`)
   - Zaimplementuj `handleSubmit` z `fetch` + obsługą redirect URL
   - Zaimplementuj mapowanie błędów serwera (`translateError`)
   - Dodaj `autofocus` na polu e-mail przez `onMounted`

5. **Utwórz `SignUpForm.vue`** w `src/components/auth/`:
   - Analogicznie do `SignInForm.vue`, dodaj trzecie pole i computed `passwordStrength`
   - Osadź `<PasswordStrengthIndicator>`
   - `handleSubmit` wysyła tylko `email` i `password` (nie `confirmPassword`)
   - Po sukcesie: `window.location.href = '/auth/confirm-email'`

6. **Zaktualizuj `signin.astro`**:
   - Usuń odczyt `?error` z URL i stary alert
   - Zaimportuj `SignInForm` i osadź jako `<SignInForm client:load />`
   - Zachowaj layout, tło i link do `/auth/signup`

7. **Zaktualizuj `signup.astro`**:
   - Analogicznie: usuń stary error handling, osadź `<SignUpForm client:load />`

8. **Zaktualizuj `src/middleware.ts`**:
   - Dodaj `/auth/signin` i `/auth/signup` do listy tras, z których zalogowany użytkownik jest przekierowywany na `/dashboard` (ochrona przed wejściem na stronę logowania gdy już jest sesja)

9. **Przetestuj scenariusze ręcznie:**
   - Logowanie poprawnymi danymi → redirect na `/dashboard`
   - Logowanie błędnymi danymi → inline error bez przeładowania
   - Rejestracja nowym e-mailem → `/auth/confirm-email`
   - Rejestracja istniejącym e-mailem → inline error
   - Odświeżenie `/auth/signin` gdy zalogowany → redirect na `/dashboard`
   - Wejście na `/dashboard` niezalogowanym → redirect na `/auth/signin`

10. **Sprawdź dostępność:**
    - Nawigacja wyłącznie klawiaturą (Tab + Enter)
    - Odczyt przez screen reader (etykiety pól, komunikaty błędów z `aria-live`)
    - Kontrast kolorów elementów UI (WCAG AA)
