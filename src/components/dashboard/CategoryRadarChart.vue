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

  isLoading.value = true;
  error.value = null;

  try {
    const params = new URLSearchParams();
    if (fromDate.value) params.set("from", fromDate.value);
    if (toDate.value) params.set("to", toDate.value);

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
  // Initial data already in props — no fetch needed on mount
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
      backgroundColor: "rgba(139, 92, 246, 0.2)",
      borderColor: "rgba(139, 92, 246, 0.8)",
      borderWidth: 2,
      pointBackgroundColor: "rgba(139, 92, 246, 1)",
      pointBorderColor: "#fff",
      pointHoverBackgroundColor: "#fff",
      pointHoverBorderColor: "rgba(139, 92, 246, 1)",
    },
  ],
}));

const radarOptions = {
  responsive: true,
  maintainAspectRatio: true,
  scales: {
    r: {
      min: 0,
      max: 100,
      ticks: {
        stepSize: 20,
        color: "rgba(255,255,255,0.4)",
        backdropColor: "transparent",
      },
      grid: { color: "rgba(255,255,255,0.1)" },
      angleLines: { color: "rgba(255,255,255,0.1)" },
      pointLabels: { color: "rgba(255,255,255,0.7)", font: { size: 12 } },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: { parsed: { r: number } }) => ` ${ctx.parsed.r.toFixed(1)}%`,
      },
    },
  },
};
</script>

<template>
  <section
    aria-labelledby="radar-chart-heading"
    class="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
  >
    <h2 id="radar-chart-heading" class="mb-4 text-lg font-semibold text-white">Skuteczność per kategoria</h2>

    <!-- Date filters -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <label for="radar-from" class="text-xs text-white/60">Od</label>
        <input
          id="radar-from"
          v-model="fromDate"
          type="date"
          :max="today"
          class="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-purple-400 focus:outline-none"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label for="radar-to" class="text-xs text-white/60">Do</label>
        <input
          id="radar-to"
          v-model="toDate"
          type="date"
          :max="today"
          class="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-purple-400 focus:outline-none"
        />
      </div>
      <div v-if="isLoading" class="flex items-center gap-2 text-sm text-white/50" aria-live="polite">
        <span
          class="size-4 animate-spin rounded-full border-2 border-white/30 border-t-purple-400"
          role="status"
          aria-label="Ładowanie danych wykresu"
        ></span>
        Ładowanie…
      </div>
    </div>

    <!-- Validation error -->
    <p v-if="dateError" role="alert" class="mb-3 text-sm text-red-400">{{ dateError }}</p>

    <!-- Fetch error -->
    <div
      v-if="error"
      role="alert"
      class="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <span aria-hidden="true">⚠</span>
      {{ error }}
    </div>

    <!-- Empty state -->
    <p v-if="!isLoading && !error && chartData.length === 0" class="text-sm text-white/50">
      Brak danych kategorii dla wybranego okresu.
    </p>

    <!-- Chart -->
    <div v-if="chartData.length > 0" class="mx-auto max-w-sm">
      <Radar :data="radarChartData" :options="radarOptions" aria-label="Wykres radarowy skuteczności per kategoria" />
    </div>
  </section>
</template>
