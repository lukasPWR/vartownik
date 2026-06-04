<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type {
  GenerationBatchCreatedDTO,
  GenerationBatchSuccessDTO,
  GenerationBatchDTO,
  SessionCreatedDTO,
  RoundSummaryDTO,
  RoundDTO,
} from "@/types";

import GenerationLoadingScreen from "./GenerationLoadingScreen.vue";
import QuizFocusMode from "./QuizFocusMode.vue";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type GameState = "loading" | "playing";
type GenerationPhase = "initiating" | "generating" | "verifying" | "preparing" | "finalizing";
type GenerationErrorType = "unprocessable" | "rate_limit" | "upstream" | "unknown";

// ---------------------------------------------------------------------------
// State — game state machine
// ---------------------------------------------------------------------------

const gameState = ref<GameState>("loading");

// Generation
const generationPhase = ref<GenerationPhase>("initiating");
const batchId = ref<string | null>(null);
const hasError = ref<boolean>(false);
const errorType = ref<GenerationErrorType | null>(null);
const pollingIntervalId = ref<ReturnType<typeof setInterval> | null>(null);
const generationStartedAt = ref<number>(Date.now());
const now = ref<number>(Date.now());
let clockInterval: ReturnType<typeof setInterval> | null = null;

const elapsedSeconds = computed(() => Math.floor((now.value - generationStartedAt.value) / 1000));

// Session
const sessionId = ref<string | null>(null);
const sessionRounds = ref<RoundSummaryDTO[]>([]);
const timerSeconds = ref<number>(20);

// Playing
const currentRoundPosition = ref<number>(1);
const currentRoundId = ref<string | null>(null);
const roundData = ref<RoundDTO | null>(null);
const currentQuestionIndex = ref<number>(0);

const scratchpadText = ref<string>("");
const isTimerExpired = ref<boolean>(false);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLLING_INTERVAL_MS = 3000;
const MAX_GENERATION_TIMEOUT_MS = 50_000;
const GENERATION_BATCH_COMMAND = {
  model: "google/gemini-2.5-flash",
  provider: "google",
  prompt_version: "v1",
  requested_questions_count: 40,
} as const;

// ---------------------------------------------------------------------------
// Phase progression (time-based heuristic)
// ---------------------------------------------------------------------------

function updatePhaseFromElapsed(seconds: number): void {
  if (seconds < 5) {
    generationPhase.value = "initiating";
  } else if (seconds < 20) {
    generationPhase.value = "generating";
  } else if (seconds < 35) {
    generationPhase.value = "verifying";
  } else if (seconds < 45) {
    generationPhase.value = "preparing";
  } else {
    generationPhase.value = "finalizing";
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

function stopPolling(): void {
  if (pollingIntervalId.value !== null) {
    clearInterval(pollingIntervalId.value);
    pollingIntervalId.value = null;
  }
}

async function pollBatchStatus(): Promise<void> {
  if (!batchId.value) return;

  const elapsed = Math.floor(Date.now() - generationStartedAt.value);
  if (elapsed > MAX_GENERATION_TIMEOUT_MS) {
    stopPolling();
    hasError.value = true;
    errorType.value = "upstream";
    return;
  }

  updatePhaseFromElapsed(Math.floor(elapsed / 1000));

  try {
    const res = await fetch(`/api/generation-batches/${batchId.value}`);

    if (!res.ok) {
      if (res.status === 422) {
        stopPolling();
        hasError.value = true;
        errorType.value = "unprocessable";
      } else {
        stopPolling();
        hasError.value = true;
        errorType.value = "upstream";
      }
      return;
    }

    const batch: GenerationBatchDTO = await res.json();

    if (batch.status === "success") {
      stopPolling();
      await createSession(batch.id);
    } else if (batch.status === "failed") {
      stopPolling();
      hasError.value = true;
      errorType.value = "unknown";
    }
    // pending → keep polling
  } catch {
    stopPolling();
    hasError.value = true;
    errorType.value = "upstream";
  }
}

function startPolling(): void {
  pollingIntervalId.value = setInterval(() => {
    void pollBatchStatus();
  }, POLLING_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Session & Round loading
// ---------------------------------------------------------------------------

async function createSession(generationBatchId: string): Promise<void> {
  generationPhase.value = "finalizing";

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_batch_id: generationBatchId, timer_seconds: 20 }),
    });

    if (!res.ok) {
      navigateToDashboard();
      return;
    }

    const session: SessionCreatedDTO = await res.json();
    sessionId.value = session.id;
    sessionRounds.value = session.rounds;
    timerSeconds.value = session.timer_seconds;

    await loadRound(1);
  } catch {
    navigateToDashboard();
  }
}

async function loadRound(position: number): Promise<void> {
  if (!sessionId.value) return;

  try {
    const res = await fetch(`/api/sessions/${sessionId.value}/rounds/${position}`);

    if (!res.ok) {
      navigateToDashboard();
      return;
    }

    const round: RoundDTO = await res.json();
    roundData.value = round;
    currentRoundId.value = round.id;
    currentRoundPosition.value = position;
    currentQuestionIndex.value = 0;
    scratchpadText.value = "";
    isTimerExpired.value = false;

    gameState.value = "playing";
  } catch {
    navigateToDashboard();
  }
}

// ---------------------------------------------------------------------------
// Generation start / retry
// ---------------------------------------------------------------------------

async function startGeneration(): Promise<void> {
  hasError.value = false;
  errorType.value = null;
  batchId.value = null;
  generationPhase.value = "initiating";
  generationStartedAt.value = Date.now();
  now.value = Date.now();

  try {
    const res = await fetch("/api/generation-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(GENERATION_BATCH_COMMAND),
    });

    if (res.status === 201) {
      const batch: GenerationBatchCreatedDTO = await res.json();
      batchId.value = batch.id;
      startPolling();
    } else if (res.status === 202) {
      const batch: GenerationBatchSuccessDTO = await res.json();
      await createSession(batch.id);
    } else if (res.status === 422) {
      hasError.value = true;
      errorType.value = "unprocessable";
    } else if (res.status === 429) {
      hasError.value = true;
      errorType.value = "rate_limit";
    } else if (res.status === 502) {
      hasError.value = true;
      errorType.value = "upstream";
    } else {
      hasError.value = true;
      errorType.value = "unknown";
    }
  } catch {
    hasError.value = true;
    errorType.value = "upstream";
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function navigateToDashboard(): void {
  window.location.href = "/dashboard";
}

// ---------------------------------------------------------------------------
// Event handlers from child components
// ---------------------------------------------------------------------------

function handleCancel(): void {
  stopPolling();
  navigateToDashboard();
}

async function handleRetry(): Promise<void> {
  stopPolling();
  await startGeneration();
}

async function handleAnswerSubmitted(): Promise<void> {
  if (!roundData.value) return;

  const isLastQuestion = currentQuestionIndex.value >= roundData.value.questions.length - 1;

  if (isLastQuestion) {
    const totalRounds = sessionRounds.value.length;
    const isLastRound = currentRoundPosition.value >= totalRounds;

    if (isLastRound) {
      navigateToDashboard();
    } else {
      await loadRound(currentRoundPosition.value + 1);
    }
  } else {
    currentQuestionIndex.value += 1;
    scratchpadText.value = "";
    isTimerExpired.value = false;
  }
}

// ---------------------------------------------------------------------------
// beforeunload guard (US-007)
// ---------------------------------------------------------------------------

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (gameState.value === "playing") {
    event.preventDefault();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  clockInterval = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  void startGeneration();
});

onUnmounted(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  if (clockInterval !== null) clearInterval(clockInterval);
  stopPolling();
});
</script>

<template>
  <div class="game-view">
    <GenerationLoadingScreen
      v-if="gameState === 'loading'"
      :phase="generationPhase"
      :has-error="hasError"
      :error-type="errorType"
      :elapsed-seconds="elapsedSeconds"
      @cancel="handleCancel"
      @retry="handleRetry"
    />

    <QuizFocusMode
      v-else-if="gameState === 'playing' && sessionId && currentRoundId && roundData"
      :session-id="sessionId"
      :round-position="currentRoundPosition"
      :round-id="currentRoundId"
      :timer-seconds="timerSeconds"
      :round-data="roundData"
      :current-question-index="currentQuestionIndex"
      :scratchpad-text="scratchpadText"
      :is-timer-expired="isTimerExpired"
      @update:scratchpad-text="scratchpadText = $event"
      @update:is-timer-expired="isTimerExpired = $event"
      @answer-submitted="handleAnswerSubmitted"
    />
  </div>
</template>
