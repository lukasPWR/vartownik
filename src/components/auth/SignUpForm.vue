<script setup lang="ts">
import { reactive, ref, computed, onMounted } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PasswordStrengthIndicator from "./PasswordStrengthIndicator.vue";
import type { SignUpFormState, SignUpFormErrors } from "./types";
import { computePasswordStrength, translateError } from "./types";

const form = reactive<SignUpFormState>({ email: "", password: "", confirmPassword: "" });
const errors = reactive<SignUpFormErrors>({});
const isSubmitting = ref(false);
const emailInputRef = ref<HTMLInputElement | null>(null);

const passwordStrength = computed(() => computePasswordStrength(form.password));

onMounted(() => {
  emailInputRef.value?.focus();
});

function validateEmail(): boolean {
  if (!form.email) {
    errors.email = "E-mail jest wymagany";
    return false;
  }
  if (!/^.+@.+\..+$/.test(form.email)) {
    errors.email = "Podaj poprawny adres e-mail";
    return false;
  }
  errors.email = undefined;
  return true;
}

function validatePassword(): boolean {
  if (!form.password) {
    errors.password = "Hasło jest wymagane";
    return false;
  }
  if (form.password.length < 8) {
    errors.password = "Hasło musi mieć co najmniej 8 znaków";
    return false;
  }
  errors.password = undefined;
  return true;
}

function validateConfirmPassword(): boolean {
  if (!form.confirmPassword) {
    errors.confirmPassword = "Potwierdzenie hasła jest wymagane";
    return false;
  }
  if (form.confirmPassword !== form.password) {
    errors.confirmPassword = "Hasła nie są identyczne";
    return false;
  }
  errors.confirmPassword = undefined;
  return true;
}

function validateAll(): boolean {
  const emailOk = validateEmail();
  const passwordOk = validatePassword();
  const confirmOk = validateConfirmPassword();
  return emailOk && passwordOk && confirmOk;
}

async function handleSubmit(): Promise<void> {
  if (!validateAll()) return;

  isSubmitting.value = true;
  errors.server = undefined;

  const formData = new FormData();
  formData.set("email", form.email);
  formData.set("password", form.password);

  try {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      body: formData,
    });

    const finalUrl = new URL(response.url);
    const errorMsg = finalUrl.searchParams.get("error");

    if (errorMsg) {
      errors.server = translateError(errorMsg);
    } else {
      window.location.href = "/auth/confirm-email";
    }
  } catch {
    errors.server = "Wystąpił błąd sieci. Spróbuj ponownie.";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <form @submit.prevent="handleSubmit" novalidate aria-label="Formularz rejestracji">
    <div class="mb-4">
      <label for="signup-email" class="block text-sm font-medium text-blue-100 mb-1">E-mail</label>
      <Input
        id="signup-email"
        ref="emailInputRef"
        v-model="form.email"
        type="email"
        autocomplete="email"
        :aria-describedby="errors.email ? 'signup-email-error' : undefined"
        :aria-invalid="!!errors.email"
        class="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-purple-400 focus:ring-purple-400"
        placeholder="twoj@email.com"
        @blur="validateEmail"
      />
      <p v-if="errors.email" id="signup-email-error" role="alert" class="mt-1 text-xs text-red-400">
        {{ errors.email }}
      </p>
    </div>

    <div class="mb-4">
      <label for="signup-password" class="block text-sm font-medium text-blue-100 mb-1">Hasło</label>
      <Input
        id="signup-password"
        v-model="form.password"
        type="password"
        autocomplete="new-password"
        :aria-describedby="
          errors.password ? 'signup-password-error' : form.password ? 'signup-password-strength' : undefined
        "
        :aria-invalid="!!errors.password"
        class="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-purple-400 focus:ring-purple-400"
        placeholder="••••••••"
        @blur="validatePassword"
      />
      <div v-if="form.password" id="signup-password-strength" class="mt-2">
        <PasswordStrengthIndicator :strength="passwordStrength" />
      </div>
      <p v-if="errors.password" id="signup-password-error" role="alert" class="mt-1 text-xs text-red-400">
        {{ errors.password }}
      </p>
    </div>

    <div class="mb-6">
      <label for="signup-confirm-password" class="block text-sm font-medium text-blue-100 mb-1">
        Potwierdź hasło
      </label>
      <Input
        id="signup-confirm-password"
        v-model="form.confirmPassword"
        type="password"
        autocomplete="new-password"
        :aria-describedby="errors.confirmPassword ? 'signup-confirm-error' : undefined"
        :aria-invalid="!!errors.confirmPassword"
        class="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-purple-400 focus:ring-purple-400"
        placeholder="••••••••"
        @blur="validateConfirmPassword"
      />
      <p v-if="errors.confirmPassword" id="signup-confirm-error" role="alert" class="mt-1 text-xs text-red-400">
        {{ errors.confirmPassword }}
      </p>
    </div>

    <div
      v-if="errors.server"
      role="alert"
      aria-live="assertive"
      class="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {{ errors.server }}
    </div>

    <Button
      type="submit"
      :disabled="isSubmitting"
      class="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold disabled:opacity-60"
    >
      <span v-if="isSubmitting" class="flex items-center gap-2">
        <svg
          class="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Rejestracja…
      </span>
      <span v-else>Zarejestruj się</span>
    </Button>
  </form>
</template>
