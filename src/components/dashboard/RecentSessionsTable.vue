<script setup lang="ts">
import { ref } from "vue";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PaginationDTO, SessionListItemDTO, SessionsResponseDTO } from "@/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  initialSessions: SessionListItemDTO[];
  initialPagination: PaginationDTO;
}

const props = defineProps<Props>();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessions = ref<SessionListItemDTO[]>(props.initialSessions);
const pagination = ref<PaginationDTO>(props.initialPagination);
const currentPage = ref(1);
const isLoading = ref(false);
const error = ref<string | null>(null);

const LIMIT = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatScore(session: SessionListItemDTO): string {
  if (!session.score_summary) return "—";
  return `${session.score_summary.accuracy_percent.toFixed(1)}%`;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function statusBadge(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "completed":
      return { label: "Ukończona", variant: "default" };
    case "in_progress":
      return { label: "W trakcie", variant: "secondary" };
    case "abandoned":
      return { label: "Przerwana", variant: "outline" };
    default:
      return { label: status, variant: "outline" };
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const totalPages = () => Math.ceil(pagination.value.total / LIMIT);

async function fetchSessions(page: number): Promise<void> {
  isLoading.value = true;
  error.value = null;

  try {
    const res = await fetch(`/api/sessions?page=${page}&limit=${LIMIT}`);

    if (res.status === 401) {
      window.location.href = "/auth/signin";
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json: SessionsResponseDTO = await res.json();
    sessions.value = json.data;
    pagination.value = json.pagination;
    currentPage.value = page;
  } catch (err) {
    error.value = "Nie udało się załadować sesji. Spróbuj ponownie.";
    console.error("[RecentSessionsTable] fetch error", err);
  } finally {
    isLoading.value = false;
  }
}

function prevPage(): void {
  if (currentPage.value > 1) fetchSessions(currentPage.value - 1);
}

function nextPage(): void {
  if (currentPage.value < totalPages()) fetchSessions(currentPage.value + 1);
}
</script>

<template>
  <section
    aria-labelledby="recent-sessions-heading"
    class="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
  >
    <h2 id="recent-sessions-heading" class="mb-4 text-lg font-semibold text-white">Ostatnie sesje</h2>

    <!-- Error -->
    <div
      v-if="error"
      role="alert"
      class="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <span aria-hidden="true">⚠</span>
      {{ error }}
    </div>

    <!-- Empty state -->
    <p v-if="!isLoading && sessions.length === 0" class="text-sm text-white/50">
      Brak sesji treningowych. Wygeneruj pierwszy quiz!
    </p>

    <!-- Table -->
    <div v-if="sessions.length > 0" class="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="text-white/60">Data</TableHead>
            <TableHead class="text-white/60">Wynik</TableHead>
            <TableHead class="text-white/60">Rundy</TableHead>
            <TableHead class="text-white/60">Status</TableHead>
            <TableHead class="text-right text-white/60">Akcja</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="session in sessions" :key="session.id" class="border-white/5 hover:bg-white/5">
            <TableCell class="text-white/80">{{ formatDate(session.started_at) }}</TableCell>
            <TableCell class="text-white/80">{{ formatScore(session) }}</TableCell>
            <TableCell class="text-white/80">{{ session.total_rounds }}</TableCell>
            <TableCell>
              <Badge :variant="statusBadge(session.status).variant">
                {{ statusBadge(session.status).label }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <a
                :href="`/sessions/${session.id}`"
                class="text-xs text-purple-300 underline hover:text-purple-100 hover:no-underline focus-visible:outline-none"
              >
                Szczegóły
              </a>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Loading overlay -->
    <div v-if="isLoading" class="mt-3 flex items-center gap-2 text-sm text-white/50" aria-live="polite">
      <span
        class="size-4 animate-spin rounded-full border-2 border-white/30 border-t-purple-400"
        role="status"
        aria-label="Ładowanie sesji"
      ></span>
      Ładowanie…
    </div>

    <!-- Pagination -->
    <div v-if="pagination.total > LIMIT" class="mt-4 flex items-center justify-between gap-3 text-sm text-white/60">
      <button
        type="button"
        :disabled="currentPage === 1 || isLoading"
        class="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Poprzednia strona"
        @click="prevPage"
      >
        ← Poprzednia
      </button>
      <span>Strona {{ currentPage }} z {{ totalPages() }}</span>
      <button
        type="button"
        :disabled="currentPage >= totalPages() || isLoading"
        class="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Następna strona"
        @click="nextPage"
      >
        Następna →
      </button>
    </div>
  </section>
</template>
