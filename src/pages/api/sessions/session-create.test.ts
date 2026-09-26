import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, UnprocessableEntityError } from "@/lib/errors";
import { POST } from "./index";
import { createSession } from "@/lib/services/sessions.service";

vi.mock("@/lib/services/sessions.service", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
}));

const batchId = "ae000000-0000-4000-8000-000000000050";

function context() {
  return {
    locals: { user: { id: "ae000000-0000-4000-8000-000000000001" }, supabase: {} },
    request: new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ generation_batch_id: batchId }),
    }),
  } as never;
}

describe("session creation error contract", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 409 for an excluded question in an old batch", async () => {
    vi.mocked(createSession).mockRejectedValue(new ConflictError("Generate a new batch."));
    const response = await POST(context());
    expect(response.status).toBe(409);
  });

  it("returns 422 for a broken rounds mapping", async () => {
    vi.mocked(createSession).mockRejectedValue(new UnprocessableEntityError("Incomplete mapping."));
    const response = await POST(context());
    expect(response.status).toBe(422);
  });
});
