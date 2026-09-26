import { describe, expect, it, vi } from "vitest";

import type { Tables, TablesInsert, TablesUpdate } from "@/db/database.types";
import { AiProviderError, ConflictError, GenerationPersistenceError } from "@/lib/errors";
import {
  createGenerationBatch,
  type GenerationBatchLifecycleRepository,
} from "@/lib/services/generation-batch.service";
import type { GenerationProvider, GenerationProviderResponse } from "@/lib/services/generation-orchestrator";
import type { CreateGenerationBatchCommand } from "@/types";

type BatchRow = Tables<"generation_batches">;

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COMMAND: CreateGenerationBatchCommand = {
  provider: "openai",
  model: "gpt-6-luna",
  prompt_version: "v1",
  requested_questions_count: 40,
};

function canonicalPayload() {
  return {
    provider: COMMAND.provider,
    model: COMMAND.model,
    prompt_version: COMMAND.prompt_version,
    requested_questions_count: COMMAND.requested_questions_count,
    execution_policy: {
      max_attempts: 6,
      max_retries: 2,
      max_output_tokens_per_attempt: 4096,
      deadline_ms: 40000,
      preflight_cost_ceiling_usd: 0.02,
    },
  };
}

function batchRow(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    id: crypto.randomUUID(),
    user_id: USER_ID,
    provider: COMMAND.provider,
    model: COMMAND.model,
    prompt_version: COMMAND.prompt_version,
    schema_version: 1,
    requested_questions_count: 40,
    returned_questions_count: 0,
    provider_attempt_count: 0,
    retry_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    status: "pending",
    estimated_cost_usd: null,
    failure_code: null,
    error_message: null,
    idempotency_key: "key-1",
    request_payload: canonicalPayload(),
    response_payload: null,
    created_at: new Date().toISOString(),
    finished_at: null,
    ...overrides,
  };
}

class MemoryRepository implements GenerationBatchLifecycleRepository {
  rows: BatchRow[];
  finalizeError: unknown = null;
  insertRaceWinner: BatchRow | null = null;

  constructor(rows: BatchRow[] = []) {
    this.rows = rows;
  }

  async countRecent(): Promise<number> {
    return this.rows.length;
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<BatchRow | null> {
    return this.rows.find((row) => row.user_id === userId && row.idempotency_key === idempotencyKey) ?? null;
  }

  async findPending(userId: string): Promise<BatchRow | null> {
    return this.rows.find((row) => row.user_id === userId && row.status === "pending") ?? null;
  }

  async recoverStalePending(batchId: string, createdBefore: string, finishedAt: string): Promise<boolean> {
    const row = this.rows.find(
      (candidate) => candidate.id === batchId && candidate.status === "pending" && candidate.created_at < createdBefore
    );
    if (!row) return false;

    Object.assign(row, {
      status: "failed",
      failure_code: "stale_pending",
      error_message: "Generation batch exceeded the stale pending threshold.",
      finished_at: finishedAt,
    });
    return true;
  }

  async insertPending(input: TablesInsert<"generation_batches">): Promise<BatchRow> {
    if (this.insertRaceWinner) {
      this.rows.push(this.insertRaceWinner);
      this.insertRaceWinner = null;
      throw { code: "23505", message: "unique violation" };
    }

    const row = batchRow({
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      finished_at: input.finished_at ?? null,
      idempotency_key: input.idempotency_key ?? null,
      response_payload: input.response_payload ?? null,
      estimated_cost_usd: input.estimated_cost_usd ?? null,
      failure_code: input.failure_code ?? null,
      error_message: input.error_message ?? null,
    });
    this.rows.push(row);
    return row;
  }

  async finalizePending(batchId: string, update: TablesUpdate<"generation_batches">): Promise<BatchRow | null> {
    if (this.finalizeError && update.status === "success") throw this.finalizeError;

    const row = this.rows.find((candidate) => candidate.id === batchId && candidate.status === "pending");
    if (!row) return null;
    Object.assign(row, update);
    return row;
  }
}

function generatedQuestions(seed: number) {
  return Array.from({ length: 10 }, (_, index) => ({
    question_text: `Question ${seed}-${index}`,
    correct_answer: { primary: `Answer ${seed}-${index}`, synonyms: [] },
    difficulty_score: 0.8,
    category_slug: "historia",
  }));
}

function response(seed: number, observedCostUsd = 0.001): GenerationProviderResponse {
  return {
    data: { questions: generatedQuestions(seed) },
    complete: true,
    usage: { inputTokens: 10, outputTokens: 20, observedCostUsd },
  };
}

function provider(
  implementation: (callIndex: number) => Promise<GenerationProviderResponse>
): GenerationProvider & { generate: ReturnType<typeof vi.fn> } {
  let callIndex = 0;
  return {
    generate: vi.fn(() => implementation(++callIndex)),
  };
}

const persistQuestions = vi.fn(async () =>
  Array.from({ length: 40 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)
);

describe("generation batch lifecycle", () => {
  it.each(["pending", "success"])("replays the same key and canonical payload for %s", async (status) => {
    const existing = batchRow({
      status,
      returned_questions_count: status === "success" ? 40 : 0,
      response_payload: status === "success" ? { rounds: [{ position: 1, question_ids: ["question-1"] }] } : null,
      finished_at: status === "success" ? new Date().toISOString() : null,
    });
    const repository = new MemoryRepository([existing]);
    const fakeProvider = provider(async (callIndex) => response(callIndex));

    const result = await createGenerationBatch(COMMAND, USER_ID, null, {
      idempotencyKey: "key-1",
      repository,
      provider: fakeProvider,
      persistQuestions,
    });

    expect(result.id).toBe(existing.id);
    expect(result.status).toBe(status);
    expect(fakeProvider.generate).not.toHaveBeenCalled();
  });

  it("rejects reuse of the same key with a changed payload", async () => {
    const repository = new MemoryRepository([
      batchRow({ request_payload: { ...canonicalPayload(), requested_questions_count: 39 } }),
    ]);

    await expect(
      createGenerationBatch(COMMAND, USER_ID, null, { idempotencyKey: "key-1", repository })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns an equivalent active batch for a different concurrent key", async () => {
    const existing = batchRow({ idempotency_key: "first-key" });
    const repository = new MemoryRepository([existing]);
    const fakeProvider = provider(async (callIndex) => response(callIndex));

    const result = await createGenerationBatch(COMMAND, USER_ID, null, {
      idempotencyKey: "second-key",
      repository,
      provider: fakeProvider,
      persistQuestions,
    });

    expect(result.id).toBe(existing.id);
    expect(result.status).toBe("pending");
    expect(fakeProvider.generate).not.toHaveBeenCalled();
  });

  it("treats a unique violation as a race won by the existing pending batch", async () => {
    const winner = batchRow({ idempotency_key: "race-key" });
    const repository = new MemoryRepository();
    repository.insertRaceWinner = winner;

    const result = await createGenerationBatch(COMMAND, USER_ID, null, {
      idempotencyKey: "race-key",
      repository,
    });

    expect(result.id).toBe(winner.id);
    expect(result.status).toBe("pending");
  });

  it("closes a stale pending batch before admitting a new key", async () => {
    const now = Date.now();
    const stale = batchRow({
      idempotency_key: "stale-key",
      created_at: new Date(now - 61_000).toISOString(),
    });
    const repository = new MemoryRepository([stale]);
    const fakeProvider = provider(async (callIndex) => response(callIndex));

    const result = await createGenerationBatch(COMMAND, USER_ID, null, {
      idempotencyKey: "new-key",
      repository,
      provider: fakeProvider,
      persistQuestions,
      now: () => now,
    });

    expect(stale).toMatchObject({ status: "failed", failure_code: "stale_pending" });
    expect(result.status).toBe("success");
    expect(repository.rows.filter((row) => row.status === "pending")).toHaveLength(0);
  });

  it("persists complete aggregate telemetry before returning success", async () => {
    const repository = new MemoryRepository();
    const fakeProvider = provider(async (callIndex) => response(callIndex));

    const result = await createGenerationBatch(COMMAND, USER_ID, null, {
      idempotencyKey: "success-key",
      repository,
      provider: fakeProvider,
      persistQuestions,
    });

    expect(result).toMatchObject({
      status: "success",
      provider_attempt_count: 4,
      retry_count: 0,
      input_tokens: 40,
      output_tokens: 80,
      estimated_cost_usd: 0.004,
      failure_code: null,
    });
    if (!("rounds" in result)) throw new Error("Expected a successful generation result.");
    expect(repository.rows[0]).toMatchObject({
      status: result.status,
      returned_questions_count: result.returned_questions_count,
      provider_attempt_count: result.provider_attempt_count,
      retry_count: result.retry_count,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      estimated_cost_usd: result.estimated_cost_usd,
      failure_code: result.failure_code,
      response_payload: { rounds: result.rounds },
    });
  });

  it("persists earlier chunk usage when a later chunk fails", async () => {
    const repository = new MemoryRepository();
    const fakeProvider = provider(async (callIndex) => {
      if (callIndex === 1) return response(callIndex, 0.003);
      if (callIndex === 2) {
        return {
          ...response(callIndex, 0.002),
          data: { questions: generatedQuestions(callIndex).slice(0, 9) },
        };
      }
      throw new AiProviderError("permanent provider failure", 400);
    });

    await expect(
      createGenerationBatch(COMMAND, USER_ID, null, {
        idempotencyKey: "failed-key",
        repository,
        provider: fakeProvider,
        persistQuestions,
      })
    ).rejects.toBeInstanceOf(AiProviderError);

    expect(repository.rows[0]).toMatchObject({
      status: "failed",
      provider_attempt_count: 3,
      retry_count: 1,
      input_tokens: 20,
      output_tokens: 40,
      estimated_cost_usd: 0.005,
      failure_code: "provider_failed",
    });
  });

  it("propagates finalization failure with its cause and never returns false success", async () => {
    const repository = new MemoryRepository();
    const databaseCause = new Error("database unavailable");
    repository.finalizeError = databaseCause;
    const fakeProvider = provider(async (callIndex) => response(callIndex));

    const error = await createGenerationBatch(COMMAND, USER_ID, null, {
      idempotencyKey: "finalization-key",
      repository,
      provider: fakeProvider,
      persistQuestions,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GenerationPersistenceError);
    expect((error as Error & { cause?: unknown }).cause).toBe(databaseCause);
    expect(repository.rows[0].status).toBe("pending");
  });
});
