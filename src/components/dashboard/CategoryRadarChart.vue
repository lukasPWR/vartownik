<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { Radar } from "vue-chartjs";
import { Chart as ChartJS, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from "chart.js";

import type { CategoryStatsItemDTO, CategoryStatsResponseDTO } from "@/types";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  initialData: CategoryStatsItemDTO[];
}

const props = defineProps<Props>();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const today = new Date().toISOString().split("T")[0];
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

const chartData = ref<CategoryStatsItemDTO[]>(props.initialData);
const fromDate = ref<string>(thirtyDaysAgo);
const toDate = ref<string>(today);
const isLoading = ref(false);
const error = ref<string | null>(null);
const loadedRange = ref({ from: thirtyDaysAgo, to: today });
const isCurrentRange = computed(
  () => loadedRange.value.from === fromDate.value && loadedRange.value.to === toDate.value
);

interface ChartColors {
  chart: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  card: string;
  primaryForeground: string;
}

const chartColors = ref<ChartColors | null>(null);

// ---------------------------------------------------------------------------
// Date validation
// ---------------------------------------------------------------------------

const dateError = computed<string | null>(() => {
  if (fromDate.value && toDate.value && fromDate.value > toDate.value) {
    return "Data od nie może być późniejsza niż data do.";
  }
  if (fromDate.value && fromDate.value > today) {
    return "Data od nie może być w przyszłości.";
  }
  if (toDate.value && toDate.value > today) {
    return "Data do nie może być w przyszłości.";
  }
  return null;
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchCategoryStats(): Promise<void> {
  if (dateError.value) return;

  const requestedFrom = fromDate.value;
  const requestedTo = toDate.value;
  isLoading.value = true;
  error.value = null;

  try {
    const params = new URLSearchParams();
    if (requestedFrom) params.set("from", requestedFrom);
    if (requestedTo) params.set("to", requestedTo);

    const res = await fetch(`/api/stats/categories?${params.toString()}`);

    if (res.status === 401) {
      window.location.href = "/auth/signin";
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json: CategoryStatsResponseDTO = await res.json();
    chartData.value = json.data;
    loadedRange.value = { from: requestedFrom, to: requestedTo };
  } catch (err) {
    error.value = "Nie udało się załadować danych wykresu. Spróbuj ponownie.";
    console.error("[CategoryRadarChart] fetch error", err);
  } finally {
    isLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Debounced watch on date inputs
// ---------------------------------------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFetch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchCategoryStats, 500);
}

watch([fromDate, toDate], scheduleFetch);

onMounted(() => {
  const styles = window.getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();

  chartColors.value = {
    chart: token("--chart-1"),
    foreground: token("--foreground"),
    mutedForeground: token("--muted-foreground"),
    border: token("--border"),
    card: token("--card"),
    primaryForeground: token("--primary-foreground"),
  };
});

// ---------------------------------------------------------------------------
// Chart.js dataset
// ---------------------------------------------------------------------------

const radarChartData = computed(() => ({
  labels: chartData.value.map((c) => c.category_name),
  datasets: [
    {
      label: "Skuteczność (%)",
      data: chartData.value.map((c) => c.accuracy_percent),
      backgroundColor: `color-mix(in srgb, ${chartColors.value?.chart} 18%, transparent)`,
      borderColor: chartColors.value?.chart,
      borderWidth: 2,
      pointBackgroundColor: chartColors.value?.chart,
      pointBorderColor: chartColors.value?.card,
      pointHoverBackgroundColor: chartColors.value?.card,
      pointHoverBorderColor: chartColors.value?.chart,
    },
  ],
}));

const radarOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: true,
  scales: {
    r: {
      min: 0,
      max: 100,
      ticks: {
        stepSize: 20,
        color: chartColors.value?.mutedForeground,
        backdropColor: "transparent",
      },
      grid: { color: chartColors.value?.border },
      angleLines: { color: chartColors.value?.border },
      pointLabels: { color: chartColors.value?.foreground, font: { size: 12 } },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: chartColors.value?.foreground,
      titleColor: chartColors.value?.primaryForeground,
      bodyColor: chartColors.value?.primaryForeground,
      borderColor: chartColors.value?.border,
      borderWidth: 1,
      callbacks: {
        label: (ctx: { parsed: { r: number } }) => ` ${ctx.parsed.r.toFixed(1)}%`,
      },
    },
  },
}));
</script>

<template>
  <section
    aria-labelledby="radar-chart-heading"
    class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
  >
    <h2 id="radar-chart-heading" class="mb-4 text-lg font-semibold text-card-foreground">Skuteczność per kategoria</h2>

    <!-- Date filters -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <label for="radar-from" class="text-xs text-muted-foreground">Od</label>
        <input
          id="radar-from"
          v-model="fromDate"
          type="date"
          :max="today"
          :aria-invalid="!!dateError"
          :aria-describedby="dateError ? 'radar-date-error' : undefined"
          class="rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label for="radar-to" class="text-xs text-muted-foreground">Do</label>
        <input
          id="radar-to"
          v-model="toDate"
          type="date"
          :max="today"
          :aria-invalid="!!dateError"
          :aria-describedby="dateError ? 'radar-date-error' : undefined"
          class="rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive"
        />
      </div>
      <div v-if="isLoading" class="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span
          class="size-4 animate-spin rounded-full border-2 border-muted border-t-foreground"
          role="status"
          aria-label="Ładowanie danych wykresu"
        ></span>
        Ładowanie…
      </div>
    </div>

    <!-- Validation error -->
    <p v-if="dateError" id="radar-date-error" role="alert" class="mb-3 text-sm text-destructive">
      {{ dateError }}
    </p>

    <!-- Fetch error -->
    <div
      v-if="error"
      role="alert"
      class="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span aria-hidden="true">⚠</span>
      {{ error }}
    </div>

    <!-- Empty state -->
    <p
      v-if="!isLoading && !error && !dateError && isCurrentRange && chartData.length === 0"
      class="text-sm text-muted-foreground"
    >
      Brak danych kategorii dla wybranego okresu.
    </p>

    <p
      v-if="!isCurrentRange && !isLoading && !dateError && !error"
      class="text-sm text-muted-foreground"
      aria-live="polite"
    >
      Aktualizowanie zakresu dat…
    </p>

    <!-- Chart -->
    <div
      v-if="chartColors && chartData.length > 0 && isCurrentRange && !isLoading && !dateError && !error"
      class="mx-auto max-w-sm"
    >
      <Radar :data="radarChartData" :options="radarOptions" aria-label="Wykres radarowy skuteczności per kategoria" />
    </div>
    <ul
      v-if="chartData.length > 0 && isCurrentRange && !isLoading && !dateError && !error"
      class="mt-4 space-y-1 text-sm text-foreground"
      aria-label="Skuteczność według kategorii"
    >
      <li v-for="category in chartData" :key="category.category_name">
        {{ category.category_name }} — {{ category.accuracy_percent.toFixed(1) }}%
      </li>
    </ul>
  </section>
</template>
