import type { APIRoute } from "astro";
import { describe, expect, it, vi } from "vitest";

import {
  AiParseError,
  AiProviderError,
  ConflictError,
  GenerationAdmissionError,
  GenerationBudgetExceededError,
  GenerationCancelledError,
  GenerationDeadlineError,
  GenerationPersistenceError,
} from "@/lib/errors";
import {
  createGenerationBatchPostHandler,
  type GenerationBatchPostDependencies,
} from "@/pages/api/generation-batches/index";
import type { GenerationBatchCreatedDTO, GenerationBatchSuccessDTO } from "@/types";

const USER_ID = "fe165a38-12c5-4f21-8c30-d238798d12b6";
const IDEMPOTENCY_KEY = "d40fbd8a-1aa9-4f4d-8d38-d1b8ae54040e";
const COMMAND = {
  model: "gpt-6-luna",
  provider: "openai",
  prompt_version: "v1",
  requested_questions_count: 40,
} as const;

const PENDING: GenerationBatchCreatedDTO = {
  id: "91307fd2-6120-4c24-9e3d-82d31e17c976",
  status: "pending",
  model: "gpt-6-luna",
  provider: "openai",
  prompt_version: "v1",
  requested_questions_count: 40,
  returned_questions_count: 0,
  provider_attempt_count: 0,
  retry_count: 0,
  input_tokens: 0,
  output_tokens: 0,
  estimated_cost_usd: null,
  failure_code: null,
  error_message: null,
  finished_at: null,
  created_at: "2026-09-26T12:00:00.000Z",
};

const SUCCESS: GenerationBatchSuccessDTO = {
  id: PENDING.id,
  status: "success",
  returned_questions_count: 40,
  provider_attempt_count: 4,
  retry_count: 0,
  input_tokens: 400,
  output_tokens: 1_600,
  estimated_cost_usd: 0.001,
  failure_code: null,
  finished_at: "2026-09-26T12:00:10.000Z",
  rounds: [],
};

type CreateBatch = NonNullable<GenerationBatchPostDependencies["createBatch"]>;

function request(body: unknown = COMMAND, key: string | null = IDEMPOTENCY_KEY): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (key !== null) headers.set("Idempotency-Key", key);

  return new Request("http://localhost/api/generation-batches", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function invoke(
  createBatchSpy: ReturnType<typeof vi.fn>,
  options: { authenticated?: boolean; body?: unknown; key?: string | null } = {}
): Promise<Response> {
  const handler = createGenerationBatchPostHandler({ createBatch: createBatchSpy as unknown as CreateBatch });
  const locals = {
    user: options.authenticated === false ? null : ({ id: USER_ID } as NonNullable<App.Locals["user"]>),
    supabase: {} as App.Locals["supabase"],
  };

  return (await handler({
    locals,
    request: request(options.body ?? COMMAND, options.key === undefined ? IDEMPOTENCY_KEY : options.key),
  } as Parameters<APIRoute>[0])) as Response;
}

async function errorCode(response: Response): Promise<string> {
  const payload = (await response.json()) as { error: { code: string } };
  return payload.error.code;
}

describe("POST /api/generation-batches", () => {
  it("returns 401 before parsing or calling the generation service", async () => {
    const createBatch = vi.fn();
    const response = await invoke(createBatch, { authenticated: false, body: { broken: true }, key: null });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
    expect(createBatch).not.toHaveBeenCalled();
  });

  it.each([null, "not-a-uuid"])("rejects a missing or invalid idempotency key (%s)", async (key) => {
    const createBatch = vi.fn();
    const response = await invoke(createBatch, { key });

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_idempotency_key");
    expect(createBatch).not.toHaveBeenCalled();
  });

  it.each([
    { ...COMMAND, model: "gpt-6-sol" },
    { ...COMMAND, requested_questions_count: 20 },
  ])("rejects a non-canonical model or count before the service", async (body) => {
    const createBatch = vi.fn();
    const response = await invoke(createBatch, { body });

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("validation_failed");
    expect(createBatch).not.toHaveBeenCalled();
  });

  it("returns 201 for an existing pending batch and forwards key plus request signal", async () => {
    const createBatch = vi.fn().mockResolvedValue(PENDING);
    const response = await invoke(createBatch);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(PENDING);
    expect(createBatch).toHaveBeenCalledOnce();
    expect(createBatch.mock.calls[0]?.[0]).toEqual(COMMAND);
    expect(createBatch.mock.calls[0]?.[1]).toBe(USER_ID);
    expect(createBatch.mock.calls[0]?.[3]).toMatchObject({ idempotencyKey: IDEMPOTENCY_KEY });
    expect(createBatch.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 202 only for a confirmed success", async () => {
    const createBatch = vi.fn().mockResolvedValue(SUCCESS);
    const response = await invoke(createBatch);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(SUCCESS);
  });

  it.each([
    [new ConflictError(), 409, "conflict"],
    [new GenerationAdmissionError(), 400, "admission_rejected"],
    [new GenerationBudgetExceededError(), 422, "budget_exhausted"],
    [new GenerationDeadlineError(), 504, "deadline_exceeded"],
    [new GenerationCancelledError(), 408, "client_cancelled"],
    [new AiProviderError("provider unavailable", 503), 502, "provider_failed"],
    [new AiParseError(), 422, "parse_failed"],
    [new GenerationPersistenceError(), 503, "persistence_failed"],
  ])("maps %s to a stable HTTP response", async (error, status, code) => {
    const createBatch = vi.fn().mockRejectedValue(error);
    const response = await invoke(createBatch);

    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
  });
});
