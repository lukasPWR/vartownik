<script setup lang="ts">
interface Props {
  currentPosition: number;
  totalQuestions: number;
}

const props = defineProps<Props>();
</script>

<template>
  <ol aria-label="Postęp pytań" class="flex items-center justify-center gap-1.5">
    <li
      v-for="i in props.totalQuestions"
      :key="i"
      class="h-2 rounded-full transition-all duration-300"
      :class="[
        i === props.currentPosition
          ? 'w-6 bg-primary'
          : i < props.currentPosition
            ? 'w-2 bg-primary/60'
            : 'w-2 bg-muted',
      ]"
      :aria-current="i === props.currentPosition ? 'step' : undefined"
    />
  </ol>
</template>
