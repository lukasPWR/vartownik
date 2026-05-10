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

const difficultyVariant = computed((): "default" | "secondary" | "destructive" | "outline" => {
  if (props.difficultyScore <= 2) return "secondary";
  if (props.difficultyScore <= 3) return "default";
  return "destructive";
});
</script>

<template>
  <header class="flex items-center justify-between px-4 py-3">
    <div class="flex items-center gap-4 text-sm text-muted-foreground">
      <span>Runda {{ props.roundPosition }}/{{ props.totalRounds }}</span>
      <span>Pytanie {{ props.questionPosition }}/{{ props.questionsPerRound }}</span>
    </div>
    <Badge :variant="difficultyVariant">{{ difficultyLabel }}</Badge>
  </header>
</template>
