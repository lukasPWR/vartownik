<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const FACTS = [
  "Pelé jest jedynym piłkarzem, który zdobył trzy tytuły mistrza świata.",
  "Mecz finałowy Mundialu 1950 obejrzało ok. 200 000 widzów na Maracanã.",
  "Christiano Ronaldo jako nastolatek przeszedł operację serca i wrócił do gry.",
  "Pierwsza transmisja telewizyjna meczu piłkarskiego odbyła się w 1937 roku w BBC.",
  "Brazylia jest jedynym krajem, który uczestniczył we wszystkich edycjach Mistrzostw Świata.",
  "Najdłuższy mecz ligowy w historii trwał 3 godziny i 23 minuty.",
  "Lionel Messi zdobył swoją pierwszą Złotą Piłkę w wieku 22 lat.",
  "Anglia jako gospodarz wygrała jedyne Mistrzostwa Świata w 1966 roku.",
];

const currentIndex = ref(0);
const isVisible = ref(true);
let intervalId: ReturnType<typeof setInterval> | null = null;

function rotateFact(): void {
  isVisible.value = false;
  setTimeout(() => {
    currentIndex.value = (currentIndex.value + 1) % FACTS.length;
    isVisible.value = true;
  }, 300);
}

onMounted(() => {
  intervalId = setInterval(rotateFact, 6000);
});

onUnmounted(() => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
});
</script>

<template>
  <div class="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
    <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ciekawostka</p>

    <Transition name="fade" mode="out-in">
      <p v-if="isVisible" :key="currentIndex" class="text-sm leading-relaxed">
        {{ FACTS[currentIndex] }}
      </p>
    </Transition>

    <div class="mt-3 flex justify-center gap-1" aria-hidden="true">
      <span
        v-for="(_, i) in FACTS"
        :key="i"
        class="h-1.5 rounded-full transition-all duration-300"
        :class="i === currentIndex ? 'w-4 bg-primary' : 'w-1.5 bg-muted'"
      />
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
