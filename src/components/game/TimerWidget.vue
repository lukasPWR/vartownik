<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useGameTimer } from "@/composables/useGameTimer";

interface Props {
  totalSeconds: number;
  autoStart?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  autoStart: true,
});

const emit = defineEmits<{
  tick: [{ remaining: number }];
  expired: [];
}>();

function handleExpired(): void {
  emit("expired");
}

const { remaining, isExpired, start } = useGameTimer(Math.min(30, Math.max(15, props.totalSeconds)), handleExpired);

const progress = computed(() => remaining.value / props.totalSeconds);

const colorClass = computed(() => {
  if (progress.value > 0.5) return "text-green-600 dark:text-green-400";
  if (progress.value > 0.25) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
});

const strokeColor = computed(() => {
  if (progress.value > 0.5) return "stroke-green-500";
  if (progress.value > 0.25) return "stroke-yellow-500";
  return "stroke-red-500";
});

const pulseClass = computed(() => (remaining.value <= 5 && !isExpired.value ? "animate-pulse" : ""));

// SVG circle
const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const dashoffset = computed(() => CIRCUMFERENCE * (1 - progress.value));

onMounted(() => {
  if (props.autoStart) start();
});
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <div role="timer" :aria-live="remaining <= 5 ? 'assertive' : 'off'" aria-atomic="true" class="sr-only">
      <span v-if="remaining <= 5">{{ remaining }} sekund</span>
    </div>

    <div :class="['relative h-20 w-20', pulseClass]">
      <svg class="h-full w-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" :r="RADIUS" fill="none" stroke-width="6" class="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          :r="RADIUS"
          fill="none"
          stroke-width="6"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="dashoffset"
          stroke-linecap="round"
          :class="[strokeColor, 'transition-all duration-1000']"
        />
      </svg>

      <span
        class="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums"
        :class="colorClass"
      >
        {{ remaining }}
      </span>
    </div>

    <span class="text-xs text-muted-foreground">sekund</span>
  </div>
</template>
