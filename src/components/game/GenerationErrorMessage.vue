<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import { Button } from "@/components/ui/button";
import type { GenerationErrorType } from "@/lib/generation-request.client";

interface Props {
  errorType: GenerationErrorType;
  errorCode: string | null;
  errorDetail: string | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  retry: [];
  cancel: [];
}>();

const MESSAGES: Record<GenerationErrorType, { title: string; description: string }> = {
  admission: {
    title: "Nieprawidłowe zlecenie",
    description: "Ustawienia generowania nie spełniają wymagań. Odśwież stronę i spróbuj ponownie.",
  },
  conflict: {
    title: "Generowanie już trwa",
    description: "Inne generowanie jest już aktywne. Spróbuj ponownie za chwilę.",
  },
  budget: {
    title: "Przekroczono budżet generowania",
    description: "Nie można bezpiecznie rozpocząć generowania. Spróbuj ponownie później.",
  },
  deadline: {
    title: "Generowanie trwało zbyt długo",
    description: "Przekroczono limit czasu generowania pytań. Spróbuj ponownie.",
  },
  cancelled: {
    title: "Generowanie anulowane",
    description: "Generowanie zostało zakończone przed utworzeniem quizu.",
  },
  rate_limit: {
    title: "Przekroczono limit",
    description: "Przekroczono limit generowania. Spróbuj ponownie za chwilę.",
  },
  transport: {
    title: "Brak połączenia z serwerem",
    description: "Nie udało się połączyć z aplikacją. Sprawdź, czy serwer działa, i spróbuj ponownie.",
  },
  provider: {
    title: "Usługa AI niedostępna",
    description: "Usługa AI jest chwilowo niedostępna. Spróbuj ponownie.",
  },
  parse: {
    title: "Problem z generowaniem pytań",
    description: "Usługa AI zwróciła niepoprawne pytania. Spróbuj ponownie.",
  },
  persistence: {
    title: "Nie udało się zapisać quizu",
    description: "Wygenerowane dane nie zostały bezpiecznie zapisane. Spróbuj ponownie.",
  },
  unknown: {
    title: "Nieznany błąd",
    description: "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.",
  },
};

const isRateLimit = computed(() => props.errorType === "rate_limit");
const retryDisabled = ref(false);
const retryCooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

const message = computed(() => MESSAGES[props.errorType]);
const showDiagnosticCode = import.meta.env.DEV;

function handleRetry(): void {
  if (isRateLimit.value) {
    retryDisabled.value = true;
    retryCooldown.value = 15;

    cooldownTimer = setInterval(() => {
      retryCooldown.value -= 1;
      if (retryCooldown.value <= 0) {
        retryDisabled.value = false;
        if (cooldownTimer !== null) {
          clearInterval(cooldownTimer);
          cooldownTimer = null;
        }
      }
    }, 1000);
  }

  emit("retry");
}

onUnmounted(() => {
  if (cooldownTimer !== null) clearInterval(cooldownTimer);
});
</script>

<template>
  <div role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-left">
    <p class="font-semibold text-destructive">{{ message.title }}</p>
    <p class="mt-1 text-sm text-muted-foreground">{{ message.description }}</p>
    <p v-if="showDiagnosticCode && props.errorCode" class="mt-2 text-xs text-muted-foreground">
      Kod diagnostyczny: {{ props.errorCode }}
    </p>
    <p v-if="showDiagnosticCode && props.errorDetail" class="mt-1 break-words text-xs text-muted-foreground">
      Szczegóły: {{ props.errorDetail }}
    </p>

    <div class="mt-4 flex flex-wrap gap-2">
      <Button :disabled="retryDisabled" @click="handleRetry">
        <span v-if="retryDisabled">Spróbuj ponownie ({{ retryCooldown }}s)</span>
        <span v-else>Spróbuj ponownie</span>
      </Button>
      <Button variant="ghost" @click="emit('cancel')">Wróć do dashboardu</Button>
    </div>
  </div>
</template>
