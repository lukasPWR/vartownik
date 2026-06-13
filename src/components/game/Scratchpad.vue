<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";

interface Props {
  modelValue: string;
  disabled: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const scratchpadRef = ref<HTMLTextAreaElement | null>(null);

function handleInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  emit("update:modelValue", target.value);
}

function scrollToView(): void {
  scratchpadRef.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function handleViewportResize(): void {
  if (document.activeElement === scratchpadRef.value) {
    scrollToView();
  }
}

onMounted(() => {
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportResize);
  }
});

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener("resize", handleViewportResize);
  }
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && scratchpadRef.value) {
      scratchpadRef.value.blur();
    }
  }
);
</script>

<template>
  <div class="space-y-2">
    <label for="scratchpad" class="text-sm font-medium text-foreground"> Twoja odpowiedź </label>
    <textarea
      id="scratchpad"
      ref="scratchpadRef"
      :value="props.modelValue"
      :readonly="props.disabled"
      :aria-disabled="props.disabled"
      :aria-label="props.disabled ? 'Pole odpowiedzi (zablokowane)' : 'Wpisz swoją odpowiedź'"
      placeholder="Wpisz tutaj swoją odpowiedź…"
      rows="4"
      class="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
      :class="{ 'opacity-60 cursor-not-allowed bg-muted': props.disabled }"
      @input="handleInput"
    />
  </div>
</template>
