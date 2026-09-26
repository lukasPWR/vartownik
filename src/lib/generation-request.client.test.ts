import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERATION_REQUEST_TIMEOUT_MS,
  createGenerationRequestClient,
  type GenerationFetch,
} from "@/lib/generation-request.client";

const FIRST_KEY = "d40fbd8a-1aa9-4f4d-8d38-d1b8ae54040e";
const SECOND_KEY = "4d424c23-dd32-4672-94a6-ae9262d929e7";

const PENDING = {
  id: "91307fd2-6120-4c24-9e3d-82d31e17c976",
  status: "pending",
};

const SUCCESS = {
  id: PENDING.id,
  status: "success",
  rounds: [],
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestKey(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit | undefined)?.headers).get("Idempotency-Key");
}

function neverSettlingFetch(signals: AbortSignal[]): GenerationFetch {
  return vi.fn((_input, init) => {
    const signal = init?.signal as AbortSignal;
    signals.push(signal);

    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("generation request client", () => {
  it("replays a transport failure with the same key and returns the pending batch", async () => {
    const fetchStub = vi
      .fn<GenerationFetch>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(response(201, PENDING));
    const client = createGenerationRequestClient({ fetch: fetchStub, generateKey: () => FIRST_KEY });

    const result = await client.start();

    expect(result).toMatchObject({ kind: "pending", batch: PENDING });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(requestKey(fetchStub.mock.calls[0] ?? [])).toBe(FIRST_KEY);
    expect(requestKey(fetchStub.mock.calls[1] ?? [])).toBe(FIRST_KEY);
  });

  it("reports a connection failure separately from an AI provider failure", async () => {
    const fetchStub = vi.fn<GenerationFetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createGenerationRequestClient({ fetch: fetchStub, generateKey: () => FIRST_KEY });

    await expect(client.start()).resolves.toMatchObject({
      kind: "failure",
      errorType: "transport",
      code: "transport_failed",
    });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("calls browser timers with the global receiver before sending the request", async () => {
    const fetchStub = vi.fn<GenerationFetch>().mockResolvedValue(response(202, SUCCESS));
    const setTimeoutWithBrowserReceiver = vi.fn(function (this: unknown, callback: () => void, delay: number) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return globalThis.setTimeout(callback, delay);
    }) as unknown as typeof setTimeout;
    const clearTimeoutWithBrowserReceiver = vi.fn(function (this: unknown, timeout: ReturnType<typeof setTimeout>) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      globalThis.clearTimeout(timeout);
    }) as unknown as typeof clearTimeout;
    const client = createGenerationRequestClient({
      fetch: fetchStub,
      generateKey: () => FIRST_KEY,
      setTimeout: setTimeoutWithBrowserReceiver,
      clearTimeout: clearTimeoutWithBrowserReceiver,
    });

    await expect(client.start()).resolves.toMatchObject({ kind: "success" });
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(setTimeoutWithBrowserReceiver).toHaveBeenCalledOnce();
    expect(clearTimeoutWithBrowserReceiver).toHaveBeenCalledOnce();
  });

  it("uses the current key for explicit replay and a new key for explicit retry", async () => {
    const fetchStub = vi
      .fn<GenerationFetch>()
      .mockResolvedValueOnce(response(201, PENDING))
      .mockResolvedValueOnce(response(201, PENDING))
      .mockResolvedValueOnce(response(202, SUCCESS));
    const keys = [FIRST_KEY, SECOND_KEY];
    const client = createGenerationRequestClient({
      fetch: fetchStub,
      generateKey: () => {
        const key = keys.shift();
        if (!key) throw new Error("No idempotency key available");
        return key;
      },
    });

    await client.start();
    await client.replay();
    const retryResult = await client.retry();

    expect(requestKey(fetchStub.mock.calls[0] ?? [])).toBe(FIRST_KEY);
    expect(requestKey(fetchStub.mock.calls[1] ?? [])).toBe(FIRST_KEY);
    expect(requestKey(fetchStub.mock.calls[2] ?? [])).toBe(SECOND_KEY);
    expect(retryResult).toMatchObject({ kind: "success", batch: SUCCESS });
  });

  it("aborts the active request when cancel is called without surfacing a terminal error", async () => {
    const signals: AbortSignal[] = [];
    const client = createGenerationRequestClient({
      fetch: neverSettlingFetch(signals),
      generateKey: () => FIRST_KEY,
    });

    const pending = client.start();
    client.cancel();

    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts the previous active request before retrying with a new key", async () => {
    const signals: AbortSignal[] = [];
    const fetchStub = vi.fn<GenerationFetch>((_input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);

      if (signals.length === 2) return Promise.resolve(response(202, SUCCESS));
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const keys = [FIRST_KEY, SECOND_KEY];
    const client = createGenerationRequestClient({
      fetch: fetchStub,
      generateKey: () => {
        const key = keys.shift();
        if (!key) throw new Error("No idempotency key available");
        return key;
      },
    });

    const firstRequest = client.start();
    const retryResult = await client.retry();

    await expect(firstRequest).resolves.toEqual({ kind: "cancelled" });
    expect(signals[0]?.aborted).toBe(true);
    expect(requestKey(fetchStub.mock.calls[1] ?? [])).toBe(SECOND_KEY);
    expect(retryResult.kind).toBe("success");
  });

  it("aborts and classifies the active request when the client timeout elapses", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const client = createGenerationRequestClient({
      fetch: neverSettlingFetch(signals),
      generateKey: () => FIRST_KEY,
    });

    const pending = client.start();
    await vi.advanceTimersByTimeAsync(GENERATION_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({
      kind: "failure",
      errorType: "deadline",
      code: "client_timeout",
    });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts on dispose and forgets the current idempotency key", async () => {
    const signals: AbortSignal[] = [];
    const client = createGenerationRequestClient({
      fetch: neverSettlingFetch(signals),
      generateKey: () => FIRST_KEY,
    });

    const pending = client.start();
    expect(client.getIdempotencyKey()).toBe(FIRST_KEY);
    client.dispose();

    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(signals[0]?.aborted).toBe(true);
    expect(client.getIdempotencyKey()).toBeNull();
  });

  it("maps stable API error codes to the shared UI error union", async () => {
    const fetchStub = vi.fn<GenerationFetch>().mockResolvedValue(
      response(503, {
        error: { code: "persistence_failed", message: "Could not persist generation." },
      })
    );
    const client = createGenerationRequestClient({ fetch: fetchStub, generateKey: () => FIRST_KEY });

    await expect(client.start()).resolves.toEqual({
      kind: "failure",
      errorType: "persistence",
      code: "persistence_failed",
      message: "Could not persist generation.",
    });
  });
});
