---
date: 2026-09-26T13:55:05+02:00
researcher: Codex
git_commit: 43f2027d18b403d0396acc16cce76712215999d1
branch: feat/m3l1
repository: vartownik
topic: "Rollout Phase 1: generation time, retry, and cost guardrails"
tags: [research, codebase, testing, generation, openai, vitest]
status: complete
last_updated: 2026-09-26
last_updated_by: Codex
---

# Research: Rollout Phase 1 — generation time, retry, and cost guardrails

**Date**: 2026-09-26T13:55:05+02:00  
**Researcher**: Codex  
**Git Commit**: `43f2027d18b403d0396acc16cce76712215999d1`  
**Branch**: `feat/m3l1`  
**Repository**: `vartownik`

## Research Question

Ground Risk #1 from `context/foundation/test-plan.md` in the current code: prove or correct the guidance that generation must complete within a defined time bound, retries and provider calls must be bounded, and maximum cost must be predictable. Locate the real failure path, quote relevant lines, identify existing tests and the cheapest useful test layer, avoid paid-provider and happy-path-only tests, and distinguish grounded risks from speculative or misleading hot-spot evidence.

## Summary

Risk #1 is real and is owned primarily by the TypeScript generation path under `src/`, not by the database migrations. The current implementation has a 60-second timeout **per OpenAI attempt**, two application retries **per 10-question chunk**, and a caller-controlled request size of up to 200 questions. It has no aggregate batch deadline, no propagated cancellation signal, no batch-wide provider-call budget, no idempotency key, and no enforceable dollar ceiling.

The normal UI request for 40 questions is four sequential chunks. It can make up to 12 provider calls and has a nominal provider/backoff envelope of about 732 seconds. The API maximum of 200 questions can make up to 60 calls and has a nominal envelope of about 3,660 seconds (61 minutes), before unbounded database time. These are arithmetic envelopes, not real end-to-end deadlines. The product guardrail is first question within 40 seconds.

The existing cost and retry fields are telemetry, not protection, and are inaccurate for multi-chunk retries. Successful batches do not persist `retry_count`; failed batches always persist `2`; successful cost aggregation omits prior paid-but-invalid attempts; and failed batches omit already incurred cost. Unknown model IDs produce `null` cost, while the API accepts any non-empty model string up to 100 characters.

The response guidance is therefore directionally correct but incomplete. Phase 1 should prove all four properties together:

1. one aggregate generation deadline that aborts active work and prevents later chunks;
2. one total provider-call budget across all chunks and retries;
3. a pre-call token/dollar ceiling based on an allowed model catalog, not only post-hoc estimation;
4. terminal, truthful persistence of total attempts/retries, incurred usage/cost, timeout/cancellation, and failure.

No automated tests or test runner exist. The cheapest useful layer is Vitest in a Node environment at the generation-orchestrator boundary, with a fake provider, fake timers, and a controlled persistence boundary. It should not call OpenAI, render Vue, launch a browser, or require pgTAP. One narrower persistence integration can cover batch finalization after the orchestration contract is deterministic.

## Risk Response Verdict

| Intended protection                   | Current evidence                                                                                                                                                                                                        | Verdict for Phase 1                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Generation ends within a defined time | OpenAI has a 60s per-attempt timeout, but the batch has up to 20 sequential chunks and database calls have no deadline. The UI's 50s timer only runs during a polling branch that the synchronous POST does not use.    | **Not protected.** Define and test one aggregate deadline, measured at the outer generation boundary.                |
| Retries are bounded                   | SDK retries are disabled. Application retries are capped at two per chunk, but the batch can contain 20 chunks.                                                                                                         | **Locally bounded, globally misleading.** Assert a total batch call budget, not only retries per chunk.              |
| Maximum cost is predictable           | Per-call output is capped at 8,192 tokens, but the model is not allowlisted, pricing can be unknown, repeated attempts are omitted from stored cost, and no admission budget rejects an expensive request.              | **Not protected.** Compute the worst-case budget before the first provider call and fail closed for unknown pricing. |
| Timeout limits calls/spend            | A timed-out attempt can be followed by retries or later chunks unless the aggregate orchestrator stops them; client/network cancellation is not propagated. Provider-side billing after local abort is not established. | **Assumption rejected.** Timeout, call count, cancellation, and spend require separate assertions.                   |
| Errors are durably visible            | Pending is inserted first, but finalization errors are logged and swallowed. Retry/cost fields do not represent all attempts.                                                                                           | **Partially protected.** Assert a truthful terminal record and explicitly handle persistence-finalization failure.   |

No correction to the wording of Risk #1 is needed. The response guidance should be strengthened from “timeout + bounded retries + predictable cost” to the four-part aggregate contract above. The plan's “integration / contract” layer is confirmed; its “timeout alone is insufficient” warning is correct.

## Detailed Findings

### 1. Actual production path

The current request path is:

```text
/game mount
  -> browser POST /api/generation-batches
  -> createGenerationBatch()
  -> insert pending batch
  -> split requested count into chunks of 10
  -> for each chunk: provider call + per-chunk retry
  -> insert/deduplicate questions
  -> finalize batch
  -> HTTP 202 after all work is complete
```

The browser fixes the ordinary request at OpenAI, `gpt-6-luna`, prompt `v1`, and 40 questions ([`src/components/game/GameView.vue:59-66`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/components/game/GameView.vue#L59-L66)). On mount it calls generation immediately ([`src/components/game/GameView.vue:307-313`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/components/game/GameView.vue#L307-L313)).

The API accepts a client-controlled model and 1–200 questions:

```ts
model: z.string().min(1).max(100),
provider: z.literal("openai"),
requested_questions_count: z.number().int().positive().max(200).default(40),
```

([`src/pages/api/generation-batches/index.ts:18-23`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/pages/api/generation-batches/index.ts#L18-L23))

The route then waits synchronously for the full batch and returns `202` only after completion ([`src/pages/api/generation-batches/index.ts:65-74`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/pages/api/generation-batches/index.ts#L65-L74)). There is no queued `201` response in the route.

The service inserts `pending`, splits the count into 10-question chunks, and processes them sequentially ([`src/lib/services/generation-batch.service.ts:385-418`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L385-L418)). The PRD's “single AI generation call” description is therefore stale (`context/foundation/prd.md:178`): the ordinary 40-question flow makes at least four provider calls.

### 2. A per-attempt timeout is not a batch deadline

The OpenAI SDK is configured with no internal retries and a 60-second timeout:

```ts
openaiClient ??= new OpenAI({
  apiKey: OPENAI_API_KEY,
  maxRetries: 0,
  timeout: REQUEST_TIMEOUT_MS,
});
```

([`src/lib/openai.client.ts:9,25-34`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L9-L34))

That setting applies to one `responses.parse` request. No deadline or `AbortSignal` enters `callOpenAI` ([`src/lib/openai.client.ts:65-81`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L65-L81)), the API does not forward `request.signal`, and the browser's POST has no signal ([`src/components/game/GameView.vue:209-222`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/components/game/GameView.vue#L209-L222)). Navigating away or pressing cancel therefore does not explicitly cancel server/provider work.

The apparent 50-second UI safeguard is checked only by `pollBatchStatus` ([`src/components/game/GameView.vue:97-105`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/components/game/GameView.vue#L97-L105)). Polling starts only for a `201`, while the current route returns `202` after inline completion ([`src/components/game/GameView.vue:224-230`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/components/game/GameView.vue#L224-L230)). The UI timeout is therefore inactive while the ordinary POST is waiting. This directly conflicts with the product requirement of first question within 40 seconds (`context/foundation/prd.md:89`).

### 3. Retry and provider-call bounds

The service constants are 2 retries, chunks of 10, and exponential delays of 1s then 2s ([`src/lib/services/generation-batch.service.ts:21-27,49-60`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L21-L60)). The loop permits three attempts for each chunk:

```ts
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  // ...
  const { data, estimatedCostUsd } = await callOpenAI(...);
  // ...
  if (attempt < MAX_RETRIES) {
    await delay(getRetryDelayMs(attempt));
  }
}
```

([`src/lib/services/generation-batch.service.ts:190-237`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L190-L237))

| Request                    | Chunks | Maximum attempts if each chunk reaches its third attempt |     Provider timeout + backoff envelope |
| -------------------------- | -----: | -------------------------------------------------------: | --------------------------------------: |
| UI default: 40 questions   |      4 |                                                       12 |    `4 × (3 × 60s + 1s + 2s)` = **732s** |
| API maximum: 200 questions |     20 |                                                       60 | `20 × (3 × 60s + 1s + 2s)` = **3,660s** |

The envelope excludes database operations, which have no application deadline, so it does not prove completion by those times.

Retry classification is also narrower than comments imply. Only provider statuses 429, 500, 502, 503, and 504 are retryable ([`src/lib/services/generation-batch.service.ts:26,55-57`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L26-L57)). An `AiProviderError` without a status exits immediately ([`src/lib/services/generation-batch.service.ts:223-226`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L223-L226)); `callOpenAI` wraps generic parse/network errors with no status ([`src/lib/openai.client.ts:97-105`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L97-L105)). By contrast, a plain wrong-question-count error is retried. Exhausted retryable provider errors are finally rethrown as `AiParseError`, which the route maps to 422 rather than the original provider status.

The rate limit is 100 **batches** per hour, not provider calls, and fails open when its database query errors ([`src/lib/services/generation-batch.service.ts:80-103`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L80-L103)). It is a non-atomic check before insert, so concurrent requests can pass together. At the API maximum, the nominal limit still permits up to 6,000 provider attempts per user/hour. There is no idempotency key; retrying the POST creates another batch, and content deduplication occurs only after provider spend.

### 4. Cost is estimated after spending, not bounded before it

Each provider attempt sets `max_output_tokens: 8192` ([`src/lib/openai.client.ts:73-81`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L73-L81)). This creates these output-token attempt ceilings:

- default 40-question request: `12 × 8,192` = **98,304 output tokens**, plus repeated input tokens;
- API maximum 200-question request: `60 × 8,192` = **491,520 output tokens**, plus repeated input tokens.

These are request-side ceilings, not evidence of actual billing. A local timeout also does not establish that provider-side generation stopped or is non-billable.

The client contains prices for only three model IDs and returns `null` for unknown models ([`src/lib/openai.client.ts:17-21,43-62`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L17-L62)). Because the API accepts any model string, no dollar maximum can be calculated or enforced for every admitted request. Even for known models, the estimate is calculated only after a response succeeds ([`src/lib/openai.client.ts:93-96`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L93-L96)); it is not an admission gate.

The service sums only the ultimately successful result returned by each chunk ([`src/lib/services/generation-batch.service.ts:405-418`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L405-L418)). Usage from a paid response that fails count validation is discarded, and if a later chunk fails, failure finalization does not persist the cost already accumulated. Provider/project hard-spend limits are mentioned only as an unchecked deployment task (`context/deployment/deploy-plan.md:283-287`); their existence is unverified external state and cannot substitute for an application contract.

### 5. Persisted retry and error data cannot prove protection

The schema stores `retry_count`, nullable `estimated_cost_usd`, status, error, and timestamps, and constrains the retry scalar to 0–2 ([`supabase/migrations/20260301000000_baseline_schema.sql:250-272`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/supabase/migrations/20260301000000_baseline_schema.sql#L250-L272)). This constrains one stored number; it does not constrain provider attempts.

Current persistence has four accuracy gaps:

- successful finalization writes cost but not `retry_count`, so the database default remains 0 ([`src/lib/services/generation-batch.service.ts:149-158`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L149-L158));
- the returned success DTO uses the **highest retry count of any chunk**, not total retries/calls ([`src/lib/services/generation-batch.service.ts:398-418,448-455`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L398-L455));
- every generation failure is finalized with `retryCount: MAX_RETRIES`, even if only one call occurred ([`src/lib/services/generation-batch.service.ts:419-423`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L419-L423));
- finalization errors are logged and swallowed, so the route can report success or rethrow the provider error while the durable row remains `pending` ([`src/lib/services/generation-batch.service.ts:149-177`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L149-L177)).

There is no durable per-attempt ledger, total call count, usage breakdown, provider response ID, cancellation state, cancellation reason, or aggregate deadline.

### 6. Existing test surface and cheapest useful layer

Fresh repository searches found:

- no `*.test.*` or `*.spec.*` files;
- no Vitest, Jest, Playwright, or Cypress configuration;
- no `test` script in `package.json` ([`package.json:5-16`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/package.json#L5-L16));
- no test framework dependencies ([`package.json:45-64`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/package.json#L45-L64));
- Supabase CLI is present, but there are no SQL tests and pgTAP cannot observe provider attempts, cancellation, or spend.

Vitest is the verified direction. Astro's current official testing guide recommends `getViteConfig()` for Astro-aware Vitest configuration, and Vitest provides fake timers for timeout/backoff tests. For this phase, a Node service test needs Vitest but does **not** need Vue Test Utils, jsdom, or a browser. Sources checked 2026-09-26: [Astro testing guide](https://docs.astro.build/en/guides/testing/), [Vitest timer mocking](https://vitest.dev/guide/mocking/timers).

The highest-signal boundary is the orchestration contract around `createGenerationBatch`, with the OpenAI call replaced by a deterministic fake and persistence controlled by a narrow fake/port. The current direct import of `callOpenAI` and singleton SDK client ([`src/lib/services/generation-batch.service.ts:4-7`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/services/generation-batch.service.ts#L4-L7), [`src/lib/openai.client.ts:23-36`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/lib/openai.client.ts#L23-L36)) means planning should introduce a small injection seam or use a module mock. An explicit provider/clock dependency will make call-count and abort assertions less brittle than mocking implementation details.

Minimum failure-first contract cases:

| Scenario                                | Deterministic assertion                                                                    | Regression caught                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Provider never settles                  | Aggregate deadline aborts the active signal; batch becomes terminal; no later chunk starts | Per-attempt timeout mistaken for end-to-end bound  |
| Retryable 429/5xx                       | Exact total calls and delays; no call beyond total budget                                  | Per-chunk retry multiplication                     |
| Non-retryable 4xx                       | One provider call, no retry, truthful terminal reason                                      | Retrying permanent failures and wasting budget     |
| Malformed or wrong-count paid response  | Exact retry policy; every attempt contributes to usage/cost accounting                     | Happy-path-only and undercounted spend             |
| Maximum chunk count                     | Total batch call ceiling holds across all chunks                                           | `retry_count <= 2` mistaken for call bound         |
| Unknown or over-budget model            | Rejected before provider call                                                              | `null` pricing and caller-selected expensive model |
| Later chunk fails after earlier success | Incurred attempts/cost remain durable; batch terminal                                      | Lost partial spend and stuck `pending`             |
| Duplicate/concurrent request            | Idempotency/admission policy prevents duplicate spend                                      | Rate-limit race and manual retry multiplication    |

The first test should not be a happy path. Start with a never-settling fake provider and assert aggregate abort, exact call count, no subsequent chunks, and terminal persistence. Then cover retry classification and cost admission. A single narrow persistence integration can verify the durable record; browser E2E and paid smoke calls are unnecessary for Risk #1.

### 7. Hot-spot evidence: useful versus misleading

`src/` was a useful likelihood scope and is now the grounded owner of the failure path:

- `src/components/game/GameView.vue` — browser request, inactive polling timeout, manual retry;
- `src/pages/api/generation-batches/index.ts` — admission schema and synchronous HTTP boundary;
- `src/lib/services/generation-batch.service.ts` — chunks, retries, rate limiting, aggregation, persistence;
- `src/lib/openai.client.ts` — provider timeout, token cap, pricing, error translation.

`supabase/migrations/` is only complementary persistence evidence. It proves which telemetry columns and checks exist, but it cannot prove provider call count, cancellation, or spend. In particular:

- `retry_count <= 2` limits a stored scalar, not retries across chunks;
- migration-level `statement_timeout` is unrelated to HTTP/provider generation;
- the generation-batch index/RLS migration covers lookup and ownership only (`supabase/migrations/20260510120000_generation_batches_index_and_rls.sql:2-46`).

The test plan correctly labels hot spots as evidence rather than anchors. Treating the migrations as the primary Risk #1 test target would be misleading; pgTAP belongs to later RLS work, not this orchestration contract.

### 8. Speculative and adjacent risks

The following must remain explicitly unproven until external configuration or provider semantics are verified:

- whether an OpenAI project hard-spend cap is configured;
- whether a locally timed-out/aborted request is guaranteed to stop provider-side work and billing;
- the hosting runtime's effective request-duration cutoff;
- the intended batch budget dimension and value: calls, tokens, dollars, or all three;
- whether `retry_count` is intended to mean total retries, highest retries within a chunk, or something else;
- whether current pricing constants and admitted model IDs are authoritative over time.

An adjacent cost-amplification issue is that POST authentication is commented out and falls back to a fixed test user ([`src/pages/api/generation-batches/index.ts:29-40`](https://github.com/lukasPWR/vartownik/blob/43f2027d18b403d0396acc16cce76712215999d1/src/pages/api/generation-batches/index.ts#L29-L40)). RLS may prevent an anonymous request from inserting the pending row before any provider call, depending on the configured key/session. That makes unauthenticated paid-call exposure plausible but not proven; it should not be claimed without grounding the deployed Supabase key behavior. It is not the primary Phase 1 contract, but the plan should not ignore it when defining admission controls.

## Architecture Insights

The generation service currently owns orchestration, retry policy, provider selection, cost aggregation, database writes, deduplication, and round distribution in one module. This makes a behavioral test possible with module mocks but obscures the distinction between:

- **admission policy** — model allowlist, request size, idempotency, maximum predicted spend;
- **execution policy** — aggregate deadline, cancellation, total calls, retry classification;
- **accounting** — per-attempt usage/cost and truthful totals;
- **persistence** — pending-to-terminal transition even on partial or finalization failure.

Phase 1 planning should preserve one end-to-end service contract while exposing these boundaries as small injectable dependencies. Tests should assert observable calls, time, aborts, and durable records—not reproduce production formulas or inspect private loop counters.

## Historical Context (from prior changes)

- `context/foundation/prd.md:89` defines the user-visible 40-second guardrail.
- `context/foundation/prd.md:178` says one provider call with up to two retries; chunking added later makes that description stale.
- Git history attributes the original retry cap to `bf71731` (2026-03-21), chunking/backoff to `9f63ef6` (2026-06-13), and OpenAI timeout/pricing to `aa1424b` (2026-09-26). The guardrails evolved independently, explaining the current mismatch.
- `context/deployment/deploy-plan.md:165-168` recognizes a timeout/stuck-pending smoke case, but it remains unchecked and would not prove total calls or spend.
- `context/deployment/deploy-plan.md:283-287,370` treats provider caps and a single paid smoke call as manual deployment work. Paid smoke is not suitable for this phase's deterministic regression gate.
- `context/changes/round-flow-contract/plan.md:37-41` deliberately excluded generator changes and consumed the batch payload downstream; it contains no prior generation-guardrail decision.
- `context/archive/` has no prior research or implementation artifacts for this risk.

## Code References

- `src/components/game/GameView.vue:59-66,97-105,209-247,262-270,307-319` — fixed UI request, ineffective polling-only timeout, unabortable POST, manual retry, lifecycle.
- `src/pages/api/generation-batches/index.ts:18-23,29-40,65-110` — permissive model/count admission, disabled auth, synchronous route and error mapping.
- `src/lib/services/generation-batch.service.ts:21-27,80-103` — retry/chunk/rate-limit constants and fail-open non-atomic rate limit.
- `src/lib/services/generation-batch.service.ts:142-177,190-237` — incomplete terminal persistence and per-chunk retry loop.
- `src/lib/services/generation-batch.service.ts:385-456` — sequential chunk orchestration and incomplete retry/cost aggregation.
- `src/lib/openai.client.ts:9-34,43-62,65-106` — per-attempt timeout, disabled SDK retries, partial pricing catalog, output cap and error translation.
- `supabase/migrations/20260301000000_baseline_schema.sql:250-272` — generation batch telemetry schema and scalar constraints.
- `package.json:5-16,45-64` — no test script or test runner dependencies.

## Related Research

No other `research.md` artifacts exist under `context/changes/` or `context/archive/` at this commit.

## Open Questions

1. Is the product's 40-second requirement the aggregate hard deadline for the entire batch, or must the architecture return the first playable round before the remaining questions finish?
2. What maximum spend should admission enforce per batch and per user window, and is it expressed in calls, input/output tokens, dollars, or all three?
3. Which exact model IDs are allowed, and what authoritative/versioned pricing source updates the application catalog?
4. Should `retry_count` be replaced or supplemented by `attempt_count`, per-attempt records, and total token/cost fields?
5. What idempotency behavior should apply when the client disconnects, retries, or submits concurrent generation requests?
6. How should a finalization-write failure be surfaced when provider spend has already occurred?
7. Is a provider/project hard-spend cap configured in each environment, and who verifies it independently of application tests?
