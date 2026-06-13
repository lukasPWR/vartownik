<script setup lang="ts">
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";

interface CategoryRef {
  name: string;
}

interface Props {
  questionText: string;
  categories: CategoryRef[];
  imagePath: string | null;
  supabaseStorageBaseUrl: string;
}

const props = defineProps<Props>();

const imageUrl = computed(() => {
  if (!props.imagePath) return null;
  return `${props.supabaseStorageBaseUrl}/${props.imagePath}`;
});
</script>

<template>
  <div class="space-y-4 rounded-xl border bg-card p-6 shadow-sm" @contextmenu.prevent style="user-select: none">
    <p class="text-foreground leading-relaxed" style="font-size: clamp(1rem, 2.5vw, 1.375rem)">
      {{ props.questionText }}
    </p>

    <img
      v-if="imageUrl"
      :src="imageUrl"
      alt=""
      loading="lazy"
      class="w-full rounded-lg object-cover"
      aria-hidden="true"
    />

    <div v-if="props.categories.length > 0" class="flex flex-wrap gap-1">
      <Badge v-for="cat in props.categories" :key="cat.name" variant="outline" class="text-xs">
        {{ cat.name }}
      </Badge>
    </div>
  </div>
</template>
