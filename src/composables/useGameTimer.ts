import { ref, onUnmounted } from "vue";

export function useGameTimer(totalSeconds: number, onExpired: () => void) {
  const remaining = ref<number>(totalSeconds);
  const isExpired = ref<boolean>(false);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    if (intervalId !== null) return;

    intervalId = setInterval(() => {
      if (remaining.value <= 1) {
        remaining.value = 0;
        isExpired.value = true;
        stop();
        onExpired();
        return;
      }
      remaining.value -= 1;
    }, 1000);
  }

  function stop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function reset(): void {
    stop();
    remaining.value = totalSeconds;
    isExpired.value = false;
  }

  onUnmounted(() => stop());

  return { remaining, isExpired, start, stop, reset };
}
