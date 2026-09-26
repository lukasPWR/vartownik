---
change_id: testing-generation-guardrails
title: Fundament testów i kontrola generowania
status: implemented
created: 2026-09-26
updated: 2026-09-26
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Fundament testów i kontrola generowania".
Risks covered: Risk #1 — generation takes too long, while retries or unbounded calls exceed the AI provider budget. Test types planned: integration, contract.
Risk response intent: prove that generation completes within a defined time bound, has bounded retries, and has a predictable maximum cost; challenge the assumption that a timeout alone limits call count or spend; avoid paid provider calls and happy-path-only tests.
After creating the folder, follow the downstream continuation rule.

Planning decisions: synchronous 40-question generation remains in scope with a 40-second aggregate deadline, six provider attempts, 4,096 output tokens per attempt, and a USD 0.02 preflight ceiling. Only `gpt-6-luna` with prompt `v1` is admitted. Generation is authenticated, idempotent, limited to one active batch per user, cancellable, and records aggregate attempt/usage telemetry.
