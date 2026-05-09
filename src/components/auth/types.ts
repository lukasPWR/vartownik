/** Stan pól formularza logowania */
export interface SignInFormState {
  email: string;
  password: string;
}

/** Błędy walidacji formularza logowania */
export interface SignInFormErrors {
  email?: string;
  password?: string;
  server?: string;
}

/** Stan pól formularza rejestracji */
export interface SignUpFormState {
  email: string;
  password: string;
  confirmPassword: string;
}

/** Błędy walidacji formularza rejestracji */
export interface SignUpFormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  server?: string;
}

/** Siła hasła obliczana po stronie klienta */
export type PasswordStrength = "empty" | "weak" | "medium" | "strong";

/** Oblicza siłę hasła na podstawie długości i różnorodności znaków */
export function computePasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) return "empty";

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const typeCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (password.length >= 10 && typeCount >= 3) return "strong";
  if (password.length >= 8 && typeCount >= 2) return "medium";
  return "weak";
}

/** Mapowanie błędów Supabase Auth na polskie komunikaty */
export const AUTH_ERROR_MAP: Record<string, string> = {
  "Invalid login credentials": "Nieprawidłowy e-mail lub hasło",
  "Email not confirmed": "Potwierdź adres e-mail przed zalogowaniem",
  "User already registered": "Konto z tym adresem e-mail już istnieje",
  "Password should be at least 6 characters": "Hasło musi mieć co najmniej 6 znaków",
};

export function translateError(msg: string): string {
  return AUTH_ERROR_MAP[msg] ?? msg;
}
