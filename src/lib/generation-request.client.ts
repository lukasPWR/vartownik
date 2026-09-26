import type { GenerationBatchCreatedDTO, GenerationBatchSuccessDTO } from "@/types";

export const GENERATION_REQUEST_TIMEOUT_MS = 42_000;

export type GenerationErrorType =
  | "admission"
  | "conflict"
  | "budget"
  | "deadline"
  | "cancelled"
  | "rate_limit"
  | "provider"
  | "parse"
  | "persistence"
  | "unknown";

export type GenerationRequestResult =
  | { kind: "pending"; batch: GenerationBatchCreatedDTO }
  | { kind: "success"; batch: GenerationBatchSuccessDTO }
  | { kind: "failure"; errorType: GenerationErrorType; code: string; message: string }
  | { kind: "cancelled" };

export type GenerationFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GenerationRequestClientDependencies {
  fetch: GenerationFetch;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  generateKey: () => string;
  timeoutMs: number;
}

export interface GenerationRequestClient {
  start(): Promise<GenerationRequestResult>;
  replay(): Promise<GenerationRequestResult>;
  retry(): Promise<GenerationRequestResult>;
  cancel(): void;
  dispose(): void;
  getIdempotencyKey(): string | null;
}

type AbortReason = "cancel" | "dispose" | "replay" | "retry" | "timeout";

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

const GENERATION_BATCH_COMMAND = {
  model: "gpt-6-luna",
  provider: "openai",
  prompt_version: "v1",
  requested_questions_count: 40,
} as const;

const CODE_TO_ERROR_TYPE: Readonly<Record<string, GenerationErrorType>> = {
  admission_rejected: "admission",
  validation_failed: "admission",
  invalid_idempotency_key: "admission",
  conflict: "conflict",
  budget_exhausted: "budget",
  deadline_exceeded: "deadline",
  client_cancelled: "cancelled",
  rate_limit: "rate_limit",
  provider_failed: "provider",
  parse_failed: "parse",
  persistence_failed: "persistence",
};

export function generationErrorTypeFromCode(code: string | null): GenerationErrorType {
  if (!code) return "unknown";
  return CODE_TO_ERROR_TYPE[code] ?? "unknown";
}

async function readError(response: Response): Promise<{ code: string; message: string }> {
  const payload = (await response.json().catch(() => null)) as ErrorEnvelope | null;
  const code = typeof payload?.error?.code === "string" ? payload.error.code : `http_${response.status}`;
  const message = typeof payload?.error?.message === "string" ? payload.error.message : "Generation request failed.";

  return { code, message };
}

/**
 * Owns the browser POST lifecycle. A start creates exactly one idempotency key;
 * transport replay reuses it, while an explicit retry rotates it.
 */
export function createGenerationRequestClient(
  overrides: Partial<GenerationRequestClientDependencies> = {}
): GenerationRequestClient {
  const dependencies: GenerationRequestClientDependencies = {
    fetch: (input, init) => globalThis.fetch(input, init),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    generateKey: () => globalThis.crypto.randomUUID(),
    timeoutMs: GENERATION_REQUEST_TIMEOUT_MS,
    ...overrides,
  };

  let idempotencyKey: string | null = null;
  let activeController: AbortController | null = null;
  let activeAbortReason: AbortReason | null = null;

  function abortActive(reason: AbortReason): void {
    if (!activeController) return;
    activeAbortReason = reason;
    activeController.abort();
  }

  async function requestOnce(key: string): Promise<GenerationRequestResult> {
    const controller = new AbortController();
    activeController = controller;
    activeAbortReason = null;

    const timeout = dependencies.setTimeout(() => {
      if (activeController === controller) {
        activeAbortReason = "timeout";
        controller.abort();
      }
    }, dependencies.timeoutMs);

    try {
      const response = await dependencies.fetch("/api/generation-batches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(GENERATION_BATCH_COMMAND),
        signal: controller.signal,
      });

      if (response.status === 201) {
        return { kind: "pending", batch: (await response.json()) as GenerationBatchCreatedDTO };
      }

      if (response.status === 202) {
        return { kind: "success", batch: (await response.json()) as GenerationBatchSuccessDTO };
      }

      const error = await readError(response);
      return {
        kind: "failure",
        errorType: generationErrorTypeFromCode(error.code),
        code: error.code,
        message: error.message,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        if (activeAbortReason === "timeout") {
          return {
            kind: "failure",
            errorType: "deadline",
            code: "client_timeout",
            message: "Generation request exceeded the client timeout.",
          };
        }

        return { kind: "cancelled" };
      }

      throw error;
    } finally {
      dependencies.clearTimeout(timeout);
      if (activeController === controller) {
        activeController = null;
        activeAbortReason = null;
      }
    }
  }

  async function requestWithTransportReplay(key: string): Promise<GenerationRequestResult> {
    try {
      return await requestOnce(key);
    } catch {
      try {
        return await requestOnce(key);
      } catch {
        return {
          kind: "failure",
          errorType: "provider",
          code: "transport_failed",
          message: "Generation service could not be reached.",
        };
      }
    }
  }

  return {
    start() {
      abortActive("retry");
      idempotencyKey = dependencies.generateKey();
      return requestWithTransportReplay(idempotencyKey);
    },
    replay() {
      if (!idempotencyKey) {
        return Promise.resolve({
          kind: "failure",
          errorType: "unknown",
          code: "missing_idempotency_key",
          message: "Generation has not been started.",
        });
      }

      abortActive("replay");
      return requestWithTransportReplay(idempotencyKey);
    },
    retry() {
      abortActive("retry");
      idempotencyKey = dependencies.generateKey();
      return requestWithTransportReplay(idempotencyKey);
    },
    cancel() {
      abortActive("cancel");
    },
    dispose() {
      abortActive("dispose");
      idempotencyKey = null;
    },
    getIdempotencyKey() {
      return idempotencyKey;
    },
  };
}
