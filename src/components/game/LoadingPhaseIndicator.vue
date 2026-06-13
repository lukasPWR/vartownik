<script setup lang="ts">
import { computed } from "vue";

type GenerationPhase = "initiating" | "generating" | "verifying" | "preparing" | "finalizing";

interface Props {
  phase: GenerationPhase;
  elapsedSeconds: number;
}

const props = defineProps<Props>();

const PHASE_LABELS: Record<GenerationPhase, string> = {
  initiating: "Inicjuję połączenie z AI…",
  generating: "Generuję pytania…",
  verifying: "Weryfikuję jakość odpowiedzi…",
  preparing: "Przygotowuję rundy…",
  finalizing: "Finalizuję sesję…",
};

const PHASE_ORDER: GenerationPhase[] = ["initiating", "generating", "verifying", "preparing", "finalizing"];

const phaseLabel = computed(() => PHASE_LABELS[props.phase]);
const phaseIndex = computed(() => PHASE_ORDER.indexOf(props.phase));

const estimatedRemaining = computed(() => {
  const estimated = 40;
  const remaining = Math.max(0, estimated - props.elapsedSeconds);
  return remaining;
});
</script>

<template>
  <div class="space-y-4">
    <p class="text-lg font-medium text-foreground">{{ phaseLabel }}</p>

    <div class="flex items-center justify-center gap-2" aria-hidden="true">
      <span
        v-for="(_, i) in PHASE_ORDER"
        :key="i"
        class="h-2 w-2 rounded-full transition-all duration-500"
        :class="[
          i === phaseIndex ? 'scale-125 animate-pulse bg-primary' : i < phaseIndex ? 'bg-primary/60' : 'bg-muted',
        ]"
      />
    </div>

    <p class="text-sm text-muted-foreground">
      <span v-if="estimatedRemaining > 0">~{{ estimatedRemaining }} sekund</span>
      <span v-else>Prawie gotowe…</span>
    </p>
  </div>
</template>
