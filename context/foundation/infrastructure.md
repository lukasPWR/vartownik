---
project: VARtownik
researched_at: 2026-06-04
recommended_platform: Cloudflare Workers
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 5 + Vue 3
  runtime: Cloudflare Workers via @astrojs/cloudflare
---

## Recommendation

**Deploy on Cloudflare Workers.**

This is a conscious tradeoff, not the default easiest path. The current app runs on Astro 5 SSR with the Node adapter, so Railway is the lower-friction runtime match. Cloudflare wins because the project is a small personal MVP, cost sensitivity is high, external managed services are acceptable in practice because Supabase is already the data layer, and Cloudflare offers a stronger long-term deploy and operations model through `wrangler`, versioned deploys, rollbacks, preview URLs, observability, and MCP support. The main cost of this decision is migration risk from `@astrojs/node` to `@astrojs/cloudflare`.

## Platform Comparison

| Platform | CLI-first | Managed / Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Railway | Pass | Partial | Pass | Pass | Pass | 4.5/5 |
| Render | Pass | Partial | Partial | Partial | Pass | 3.5/5 |
| Vercel | Pass | Pass | Pass | Pass | Partial | 4/5 |
| Netlify | Partial | Pass | Pass | Partial | Pass | 4/5 |
| Fly.io | Pass | Partial | Partial | Pass | Fail | 3/5 |

### Notes by Platform

**Cloudflare Workers**

Official Astro support is strong and current. Cloudflare provides a framework guide for Astro, native preview URLs, Git-based Workers Builds, version rollbacks via `wrangler rollback`, and strong observability. Workers pricing is attractive for MVP usage, but this app should be treated as a **Paid Workers** candidate rather than Free-only because SSR plus auth plus upstream calls can outgrow the Free CPU budget quickly. The main technical risk is runtime compatibility: Astro warns that `workerd` does not support CommonJS syntax, so dependency compatibility must be verified carefully.

**Railway**

Railway is the cleanest drop-in deployment target for the current repository because the app already uses `@astrojs/node` in standalone mode. It has strong CLI support, PR environments, good logs, and both CLI and MCP paths for agents. It loses the top spot only because the project is highly cost-sensitive and Cloudflare offers a better long-term edge/serverless operating model. Railway also does not actually satisfy the single-vendor preference because Supabase remains external.

**Render**

Render supports Astro SSR as a Web Service with the Node adapter and has solid docs and growing agent support. It is a viable fallback if Cloudflare migration friction turns out to be too high. It ranks below Railway because the operational model is more traditional service hosting, and its free tier spin-down behavior is poor for an app that should feel instantly available to one private user.

**Vercel**

Vercel supports Astro SSR well and has strong preview workflows, logs, and rollback tooling. It is operationally polished, but less attractive here because the app is not Vercel-native, the project is cost-sensitive, and Hobby usage caps are not ideal for unpredictable SSR/backend behavior. It also does not reduce architectural complexity relative to Supabase.

**Netlify**

Netlify supports Astro well and has strong docs plus an official MCP server. However, the pricing model is credit-based, rollback and deployment management are less terminal-centric than Cloudflare and Railway, and it still requires an adapter migration. It is a reasonable alternative, but not the most aligned with this repository.

**Fly.io**

Fly.io is good when persistent processes, containers, or custom networking are central requirements. That is not the case for this MVP today. It introduces more infrastructure surface area and more operational responsibility than necessary for a solo, low-scale app.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Cloudflare wins on MVP economics, terminal-first operations, strong versioning and rollback semantics, preview support, and first-class support for agent workflows. It is especially attractive if the app may later gain realtime or edge-facing behavior, because Workers plus Durable Objects cover that path without changing platform families. The tradeoff is that this repository must migrate from the Node adapter to the Cloudflare adapter and verify runtime compatibility.

#### 2. Railway

Railway scored second because it is the easiest way to deploy the current codebase exactly as it exists now. If Cloudflare dependency/runtime compatibility becomes painful, Railway is the fallback with the least migration cost. The gap versus Cloudflare is mostly cost posture and the fact that it remains a more conventional hosted-process model.

#### 3. Render

Render placed third because it can host the app with modest changes and has improving agent support. It trails Railway because its operational story is less crisp for this exact repository, and its free-tier behavior is not ideal for a personal SSR app that should feel immediately responsive when opened.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate - Weaknesses

1. The current repository is not written for Cloudflare today. It is explicitly configured for `@astrojs/node`, so choosing Cloudflare means accepting migration work before the first stable deploy.
2. Astro warns that `workerd` does not support CommonJS syntax such as `require` and `module.exports`. Even if your own code is clean, one transitive dependency can become a deployment blocker.
3. Preview URLs on Workers have an important observability limitation today: you cannot view logs for preview URLs through Workers Logs, `wrangler tail`, or Logpush. That weakens the debug loop for branch previews.
4. If the app later introduces Durable Objects for realtime coordination, Workers preview URL behavior has additional limitations and must be re-evaluated.
5. Cloudflare looks cheapest on the homepage, but for SSR with auth and external calls the practical starting plan is likely Workers Paid, not a naive assumption that Free is enough forever.

### Pre-Mortem - How This Could Fail

The team chose Cloudflare because it looked like the most future-proof and cheapest platform, and because the operational tooling was clearly stronger than classic PaaS options. The mistake was treating that strategic fit as if it were the same thing as short-term implementation fit. The repository already ran on Astro SSR with the Node adapter, but the migration to `@astrojs/cloudflare` exposed runtime assumptions hidden inside dependencies and build tooling. A package that worked fine under Node broke under `workerd`, and the debugging loop was slower than expected because preview URLs did not have full log visibility. The team then burned time chasing environment and runtime mismatches rather than finishing product work. Meanwhile, the practical deployment ended up on Workers Paid anyway, so the “free forever” assumption never materialized. Six months later, the platform itself was not the failure. The failure was underestimating migration cost, assuming framework support meant repository compatibility, and choosing the target before proving the app could run there cleanly in local and preview environments.

### Unknown Unknowns

- Cloudflare Workers preview URLs are public by default when enabled. They can be protected with Cloudflare Access, but this has to be configured intentionally.
- Preview URLs currently do not expose logs, which changes how production-like a preview environment really is for debugging.
- `nodejs_compat` makes many Node APIs available, including `node:crypto`, but compatibility is not the same as identical Node runtime behavior across every npm dependency.
- Workers Free has a tight CPU budget per invocation. Even if the app appears fine in light testing, auth and upstream request patterns can make Paid the realistic floor.
- Smart Placement can improve backend-adjacent latency, but it is a performance optimization layer, not a guarantee that all requests execute near Supabase automatically.

## Operational Story

- **Preview deploys**: Cloudflare Workers supports versioned and aliased preview URLs on `workers.dev`. These are public by default and should be protected with Cloudflare Access if the app should stay private.
- **Secrets**: Store production secrets as Worker secrets and non-sensitive config as environment variables in Wrangler or the dashboard. Required secrets can be declared so deploys fail fast when values are missing.
- **Rollback**: Use `wrangler rollback` or the Workers dashboard Deployments view. Rollback creates a new deployment pointing back to a prior version. Code rolls back; external data changes do not.
- **Approval**: A human should approve the first production publish, secret rotation, and any schema-affecting rollout. Routine deploys, preview uploads, and read-only diagnostics are safe to automate.
- **Logs**: Use Workers Logs, observability queries, and `wrangler tail` for the active Worker. Important caveat: preview URLs do not currently expose logs.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Dependency incompatible with `workerd` or CommonJS restrictions | Devil's advocate | M | H | Run a migration spike before committing fully: swap adapter on a branch, build, run local preview, and verify auth/API routes. |
| SSR CPU budget exceeds Workers Free limits | Research finding | M | M | Start with Workers Paid budgeting assumptions and measure real request costs with observability before relying on Free. |
| Debugging previews is slower because preview URLs have no logs | Unknown unknowns | H | M | Treat preview URLs as validation surfaces, not full observability surfaces; use staged production-like deploys for deeper diagnosis. |
| Rollback restores code but not data side effects | Devil's advocate | M | H | Separate schema/data changes from app rollouts and require manual approval for destructive or irreversible data changes. |
| Privacy leak through public preview URLs | Unknown unknowns | M | M | Protect previews with Cloudflare Access from day one and verify policy scope before sharing URLs. |
| Smart Placement assumptions do not materially improve latency to Supabase | Unknown unknowns | M | L | Measure before enabling broadly; treat it as an optimization after basic deployment stability is proven. |
| Migration work delays feature delivery | Pre-mortem | M | H | Timebox the migration spike. If critical incompatibilities appear, fall back to Railway without re-opening the platform search. |

## Getting Started

1. Create a migration branch and replace the Node adapter in `astro.config.mjs` with `@astrojs/cloudflare`.
2. Add a `wrangler.jsonc` configuration with `compatibility_date`, `preview_urls`, observability, and `nodejs_compat`.
3. Move production secrets to Worker secrets and validate that `SUPABASE_URL`, `SUPABASE_KEY`, and OpenRouter credentials resolve correctly under Cloudflare.
4. Run a first local verification of auth, middleware redirects, and the question-management APIs, especially code paths that use `node:crypto`.
5. Connect the repository to Workers Builds or deploy first with `npx wrangler deploy`, then enable preview URLs and Access protection for non-production versions.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
