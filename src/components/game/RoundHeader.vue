<script setup lang="ts">
import { Badge } from "@/components/ui/badge";
import { computed } from "vue";

interface Props {
  roundPosition: number;
  totalRounds: number;
  questionPosition: number;
  questionsPerRound: number;
  difficultyScore: number;
}

const props = defineProps<Props>();

const difficultyLabel = computed(() => {
  if (props.difficultyScore <= 1) return "Łatwy";
  if (props.difficultyScore <= 2) return "Średni";
  if (props.difficultyScore <= 3) return "Trudny";
  if (props.difficultyScore <= 4) return "Bardzo trudny";
  return "Ekspert";
});

const difficultyVariant = computed((): "default" | "secondary" | "outline" => {
  if (props.difficultyScore <= 1) return "secondary";
  if (props.difficultyScore <= 3) return "outline";
  return "default";
});
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span>Runda {{ props.roundPosition }}/{{ props.totalRounds }}</span>
      <span>Pytanie {{ props.questionPosition }}/{{ props.questionsPerRound }}</span>
    </div>
    <Badge :variant="difficultyVariant">{{ difficultyLabel }}</Badge>
  </header>
</template>
