<script setup lang="ts">
interface Props {
  currentPosition: number;
  totalQuestions: number;
}

const props = defineProps<Props>();
</script>

<template>
  <div class="space-y-2 text-center">
    <p class="text-sm text-muted-foreground">Pytanie {{ props.currentPosition }} z {{ props.totalQuestions }}</p>
    <ol aria-label="Postęp pytań" class="flex items-center justify-center gap-1.5">
      <li
        v-for="i in props.totalQuestions"
        :key="i"
        class="h-2 rounded-full motion-safe:transition-all motion-safe:duration-300"
        :class="[
          i === props.currentPosition
            ? 'w-6 bg-primary'
            : i < props.currentPosition
              ? 'w-2 bg-primary/60'
              : 'w-2 bg-muted',
        ]"
        :aria-current="i === props.currentPosition ? 'step' : undefined"
      >
        <span class="sr-only">
          Pytanie {{ i }}:
          {{ i < props.currentPosition ? "ukończone" : i === props.currentPosition ? "aktualne" : "przed Tobą" }}
        </span>
      </li>
    </ol>
  </div>
</template>
