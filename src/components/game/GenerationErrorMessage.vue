<script setup lang="ts">
import { ref, computed } from "vue";
import { Button } from "@/components/ui/button";

type GenerationErrorType = "unprocessable" | "rate_limit" | "upstream" | "unknown";

interface Props {
  errorType: GenerationErrorType;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  retry: [];
  cancel: [];
}>();

const MESSAGES: Record<GenerationErrorType, { title: string; description: string }> = {
  unprocessable: {
    title: "Problem z generowaniem pytań",
    description: "Wystąpił problem z generowaniem pytań przez AI. Spróbuj ponownie.",
  },
  rate_limit: {
    title: "Przekroczono limit",
    description: "Przekroczono limit generowania. Spróbuj ponownie za chwilę.",
  },
  upstream: {
    title: "Usługa AI niedostępna",
    description: "Usługa AI jest chwilowo niedostępna. Spróbuj ponownie.",
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
</script>

<template>
  <div role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-left">
    <p class="font-semibold text-destructive">{{ message.title }}</p>
    <p class="mt-1 text-sm text-muted-foreground">{{ message.description }}</p>

    <div class="mt-4 flex gap-2">
      <Button :disabled="retryDisabled" @click="handleRetry">
        <span v-if="retryDisabled">Spróbuj ponownie ({{ retryCooldown }}s)</span>
        <span v-else>Spróbuj ponownie</span>
      </Button>
      <Button variant="ghost" @click="emit('cancel')">Wróć do dashboardu</Button>
    </div>
  </div>
</template>
