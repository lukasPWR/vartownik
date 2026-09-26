<script setup lang="ts">
import { Button } from "@/components/ui/button";
import type { GenerationErrorType } from "@/lib/generation-request.client";
import LoadingPhaseIndicator from "./LoadingPhaseIndicator.vue";
import FootballFactCarousel from "./FootballFactCarousel.vue";
import GenerationErrorMessage from "./GenerationErrorMessage.vue";

type GenerationPhase = "initiating" | "generating" | "verifying" | "preparing" | "finalizing";

interface Props {
  phase: GenerationPhase;
  hasError: boolean;
  errorType: GenerationErrorType | null;
  errorCode: string | null;
  errorDetail: string | null;
  elapsedSeconds: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  cancel: [];
  retry: [];
}>();
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
    <div class="w-full max-w-md space-y-8 text-center">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ props.hasError ? "Nie udało się przygotować quizu" : "Przygotowuję Twój quiz" }}
      </h1>

      <div v-if="!props.hasError" role="status" aria-live="polite" aria-atomic="true">
        <LoadingPhaseIndicator :phase="props.phase" :elapsed-seconds="props.elapsedSeconds" />
      </div>

      <FootballFactCarousel v-if="!props.hasError" />

      <GenerationErrorMessage
        v-if="props.hasError && props.errorType"
        :error-type="props.errorType"
        :error-code="props.errorCode"
        :error-detail="props.errorDetail"
        @retry="emit('retry')"
        @cancel="emit('cancel')"
      />

      <Button v-if="!props.hasError" variant="ghost" class="mt-4" @click="emit('cancel')">
        Anuluj i wróć do dashboardu
      </Button>
    </div>
  </div>
</template>
