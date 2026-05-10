<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { RoundDTO, CreateAttemptCommand, AttemptDTO } from "@/types";
import RoundHeader from "./RoundHeader.vue";
import QuestionBlock from "./QuestionBlock.vue";
import TimerWidget from "./TimerWidget.vue";
import Scratchpad from "./Scratchpad.vue";
import QuestionProgressIndicator from "./QuestionProgressIndicator.vue";

interface Props {
  sessionId: string;
  roundPosition: number;
  roundId: string;
  timerSeconds: number;
  roundData: RoundDTO;
  currentQuestionIndex: number;
  scratchpadText: string;
  isTimerExpired: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  "answer-submitted": [];
  "round-completed": [];
  "update:scratchpadText": [value: string];
  "update:isTimerExpired": [value: boolean];
}>();

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

const TOTAL_ROUNDS = 4;
const SUPABASE_STORAGE_BASE_URL = import.meta.env.PUBLIC_SUPABASE_URL
  ? `${import.meta.env.PUBLIC_SUPABASE_URL}/storage/v1/object/public/question-images`
  : "";

const currentQuestion = computed(() => props.roundData.questions[props.currentQuestionIndex] ?? null);
const timerKey = ref(0); // force re-mount TimerWidget on new question

const safeTimerSeconds = computed(() => {
  const t = props.timerSeconds;
  return t >= 15 && t <= 30 ? t : 20;
});

// ---------------------------------------------------------------------------
// Attempt submission with retry logic
// ---------------------------------------------------------------------------

async function submitAttemptWithRetry(command: CreateAttemptCommand, attempt = 1): Promise<AttemptDTO | null> {
  const DELAYS = [500, 1000, 2000];
  try {
    const res = await fetch(`/api/rounds/${props.roundId}/attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });

    if (res.ok) {
      return (await res.json()) as AttemptDTO;
    }

    if (attempt <= DELAYS.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAYS[attempt - 1]));
      return submitAttemptWithRetry(command, attempt + 1);
    }

    // Persist for retry on next navigation
    const pending = JSON.parse(sessionStorage.getItem("pendingAttempts") ?? "[]") as CreateAttemptCommand[];
    pending.push(command);
    sessionStorage.setItem("pendingAttempts", JSON.stringify(pending));
    return null;
  } catch {
    if (attempt <= DELAYS.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAYS[attempt - 1]));
      return submitAttemptWithRetry(command, attempt + 1);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Submit the current question
// ---------------------------------------------------------------------------

const isSubmitting = ref(false);

async function submitCurrentQuestion(timerExpired: boolean): Promise<void> {
  if (isSubmitting.value || !currentQuestion.value) return;
  isSubmitting.value = true;

  const q = currentQuestion.value;
  const timeTakenMs = timerExpired
    ? safeTimerSeconds.value * 1000
    : (safeTimerSeconds.value - (props.isTimerExpired ? 0 : safeTimerSeconds.value)) * 1000;

  const command: CreateAttemptCommand = {
    question_id: q.question_id,
    position: q.position,
    scratchpad: props.scratchpadText || null,
    time_taken_ms: Math.max(0, timeTakenMs),
    timer_expired: timerExpired,
  };

  await submitAttemptWithRetry(command);

  isSubmitting.value = false;
  timerKey.value += 1;
  emit("answer-submitted");
}

// ---------------------------------------------------------------------------
// Timer events
// ---------------------------------------------------------------------------

function handleTimerExpired(): void {
  emit("update:isTimerExpired", true);
  void submitCurrentQuestion(true);
}

// ---------------------------------------------------------------------------
// Flush any pending attempts on mount
// ---------------------------------------------------------------------------

async function flushPendingAttempts(): Promise<void> {
  const raw = sessionStorage.getItem("pendingAttempts");
  if (!raw) return;

  const pending: CreateAttemptCommand[] = JSON.parse(raw);
  if (pending.length === 0) return;

  sessionStorage.removeItem("pendingAttempts");
  for (const cmd of pending) {
    await submitAttemptWithRetry(cmd);
  }
}

onMounted(() => {
  void flushPendingAttempts();
});
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <RoundHeader
      :round-position="props.roundPosition"
      :total-rounds="TOTAL_ROUNDS"
      :question-position="props.currentQuestionIndex + 1"
      :questions-per-round="props.roundData.questions.length"
      :difficulty-score="currentQuestion?.difficulty_score ?? 1"
    />

    <main class="flex flex-1 flex-col items-center gap-6 px-4 py-6 sm:px-6">
      <div v-if="currentQuestion" class="w-full max-w-xl space-y-6">
        <div class="flex justify-center">
          <TimerWidget
            :key="timerKey"
            :total-seconds="safeTimerSeconds"
            :auto-start="true"
            @expired="handleTimerExpired"
          />
        </div>

        <QuestionBlock
          :question-text="currentQuestion.question_text"
          :categories="currentQuestion.categories"
          :image-path="null"
          :supabase-storage-base-url="SUPABASE_STORAGE_BASE_URL"
        />

        <Scratchpad
          :model-value="props.scratchpadText"
          :disabled="props.isTimerExpired || isSubmitting"
          @update:model-value="emit('update:scratchpadText', $event)"
        />

        <QuestionProgressIndicator
          :current-position="props.currentQuestionIndex + 1"
          :total-questions="props.roundData.questions.length"
        />
      </div>

      <div v-else class="flex flex-col items-center gap-2">
        <div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <p class="text-sm text-muted-foreground">Ładowanie pytania…</p>
      </div>
    </main>
  </div>
</template>
