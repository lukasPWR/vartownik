<script setup lang="ts">
import type { PasswordStrength } from "./types";

const props = defineProps<{
  strength: PasswordStrength;
}>();

const labels: Record<PasswordStrength, string> = {
  empty: "",
  weak: "Słabe",
  medium: "Średnie",
  strong: "Silne",
};

const segmentColors = (index: number): string => {
  if (props.strength === "empty") return "bg-white/20";
  if (props.strength === "weak") return index === 0 ? "bg-red-500" : "bg-white/20";
  if (props.strength === "medium") return index <= 1 ? "bg-yellow-400" : "bg-white/20";
  return "bg-green-400";
};

const labelColor: Record<PasswordStrength, string> = {
  empty: "",
  weak: "text-red-400",
  medium: "text-yellow-400",
  strong: "text-green-400",
};
</script>

<template>
  <div aria-live="polite" aria-label="Siła hasła">
    <div class="flex gap-1 mb-1">
      <span
        v-for="i in 3"
        :key="i"
        class="h-1 flex-1 rounded-full transition-colors duration-200"
        :class="segmentColors(i - 1)"
        aria-hidden="true"
      />
    </div>
    <p v-if="strength !== 'empty'" class="text-xs" :class="labelColor[strength]">
      {{ labels[strength] }}
    </p>
  </div>
</template>
