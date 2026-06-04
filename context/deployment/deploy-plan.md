# Cloudflare Integration and Deployment Plan

Project: VARtownik
Created: 2026-06-04
Basis: `context/foundation/infrastructure.md`
Target platform: Cloudflare Workers
Current repo state: Astro 5 SSR app using `@astrojs/node`; target state is Astro SSR on Cloudflare Workers using `@astrojs/cloudflare` and Wrangler.

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked / needs decision

## Non-Negotiable Guardrails

- `[ ]` Do not commit secrets. Use Cloudflare Worker secrets for `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, and `GOOGLE_API_KEY`.
- `[ ]` Treat `wrangler.jsonc` as the source of truth for Worker configuration. Avoid dashboard-only config drift.
- `[ ]` Use Workers commands, not Pages commands. `wrangler deploy` is the deployment path for this plan.
- `[ ]` Protect public preview URLs with Cloudflare Access before sharing them.
- `[ ]` Require human approval before first production publish, secret rotation, domain cutover, rollback, or any Supabase schema/data mutation.
- `[ ]` Keep the migration timeboxed. If `workerd` compatibility blocks progress, fall back to Railway as defined in `infrastructure.md`.

## Phase 0 - Preflight and Ownership

- `[ ]` Confirm the Cloudflare account, account ID, and desired Worker name. Recommended Worker name: `vartownik`.
- `[ ]` Confirm production domain strategy: temporary `workers.dev` first, custom domain only after production smoke tests pass.
- `[ ]` Confirm Cloudflare plan assumptions. Treat Workers Paid as the realistic floor for SSR plus auth and upstream AI calls.
- `[ ]` Confirm Supabase production project exists and migrations are applied.
- `[ ]` Confirm OpenRouter and Google API keys have spending limits or quotas before deploying AI generation endpoints.
- `[ ]` Confirm who owns manual gates: Cloudflare account access, Supabase dashboard changes, provider key rotation, and DNS/domain cutover.

Support steps:

- `[ ]` If Cloudflare account or billing is not ready, stop after local Worker verification and do not publish.
- `[ ]` If Supabase production is not ready, deploy only a non-production Worker pointed at a staging Supabase project.

## Phase 0A - CLI Setup and Local Tooling

Goal: make Cloudflare and Supabase operations repeatable from the terminal, while keeping production access explicit and minimal.

### Node and package execution

- `[ ]` Confirm Node.js matches `.nvmrc`: `v22.14.0`.
- `[ ]` Prefer project-local CLI execution through `npx` until the deployment flow is stable:
  - `npx wrangler --version`
  - `npx supabase --version`
- `[ ]` If a CLI is installed globally, verify it is not older than the project-local version before using it.
- `[ ]` Do not add global auth tokens, project refs, or production DB passwords to committed files.

### Cloudflare Wrangler CLI

- `[ ]` Install Wrangler as a dev dependency during the adapter migration if it is not already present.
- `[ ]` Authenticate interactively on the local machine:
  - `npx wrangler login`
  - `npx wrangler whoami`
- `[ ]` For CI later, use a scoped Cloudflare API token instead of interactive login.
- `[ ]` Record `CLOUDFLARE_ACCOUNT_ID` in local shell profile, CI secret storage, or deployment docs; do not commit it unless it is intentionally treated as non-sensitive project metadata.
- `[ ]` Validate the target account before every first deploy from a new machine:
  - `npx wrangler whoami`
  - `npx wrangler deployments list` after the Worker exists.
- `[ ]` Keep one Worker naming convention:
  - production: `vartownik`
  - staging: `vartownik-staging` or Wrangler environment equivalent, selected before implementation.

### Supabase CLI

- `[ ]` Confirm Docker Desktop or a compatible container runtime is running before local Supabase commands.
- `[ ]` Start the local Supabase stack:
  - `npx supabase start`
  - `npx supabase status`
- `[ ]` Copy local `API URL` and `anon key` from `npx supabase status` into local `.env`.
- `[ ]` Keep local `.env` pointed at local Supabase by default:
  - `SUPABASE_URL=http://127.0.0.1:54321`
  - `SUPABASE_KEY=<local anon key from supabase status>`
- `[ ]` Log in to the Supabase CLI only when remote schema management is needed:
  - `npx supabase login`
- `[ ]` Link the repository to the hosted Supabase project only after the target project is confirmed:
  - `npx supabase link --project-ref <project-ref>`
- `[ ]` Store the linked project ref only in Supabase CLI local state; do not hardcode remote database URLs in app config.

Support steps:

- `[ ]` If `npx supabase start` fails, check Docker memory, port conflicts on `54321`, `54322`, `54323`, and whether stale containers need `npx supabase stop`.
- `[ ]` If `npx wrangler login` cannot open a browser, use the OAuth URL it prints manually, or defer to a scoped API token for CI/headless use.
- `[ ]` If multiple Cloudflare or Supabase accounts are used on the same machine, always run `whoami` / project listing before secrets or deploy commands.

## Phase 1 - Version and Adapter Decision Gate

- `[ ]` Check the dependency compatibility matrix before installation.
- `[ ]` Current app uses `astro@^5.18.1`; avoid silently upgrading to Astro 6 during deployment.
- `[ ]` First preferred path: install the latest Astro 5-compatible `@astrojs/cloudflare` major and `wrangler`.
- `[ ]` If `npx astro add cloudflare` or npm resolution requires Astro 6 / `@astrojs/cloudflare` v13, stop and decide whether to split this into a separate Astro 6 upgrade.
- `[ ]` After the adapter version is selected, verify the correct Wrangler entrypoint.

Implementation notes:

- Astro 6 / `@astrojs/cloudflare` v13 uses `@astrojs/cloudflare/entrypoints/server`.
- Older Astro 5 adapter behavior may use a built output entrypoint such as `dist/_worker.js/index.js`.
- Do not guess. Build once and verify generated output before deploying.

Support steps:

- `[ ]` If a dependency fails under `workerd` because of CommonJS syntax, try targeted Vite dependency pre-compilation only for that dependency.
- `[ ]` If the incompatibility is broad or unclear after the timebox, revert the adapter branch and use Railway as fallback.

## Phase 2 - Code and Configuration Migration

- `[ ]` Create a migration branch.
- `[ ]` Replace `@astrojs/node` adapter usage in `astro.config.mjs` with `@astrojs/cloudflare`.
- `[ ]` Remove `@astrojs/node` only after the Cloudflare build and local preview pass.
- `[ ]` Add Wrangler configuration with:
  - Worker name.
  - Compatibility date checked on implementation day.
  - `compatibility_flags: ["nodejs_compat"]`.
  - Preview URLs enabled.
  - Observability enabled.
  - Required secret names declared.
- `[ ]` Generate Cloudflare types with `wrangler types` if bindings are introduced.
- `[ ]` Update scripts only after the adapter path is stable. Candidate scripts:
  - `build`: `astro check && astro build`
  - `preview`: `astro preview`
  - `deploy:cf`: `wrangler deploy`
  - `deploy:cf:staging`: environment-specific build/deploy command if environments are used.
- `[ ]` Keep `vite.build.minify = false` during migration if Worker runtime errors are hard to read; re-enable minification after diagnostics are stable.

Known repo-specific compatibility checks:

- `[ ]` `src/lib/services/generation-batch.service.ts` imports `createHash` from `"crypto"`; normalize to `"node:crypto"` or Web Crypto if the Worker build complains.
- `[ ]` `src/lib/services/questions.service.ts` already imports from `"node:crypto"`; verify under `nodejs_compat`.
- `[ ]` `AbortSignal.timeout(60000)` is used for AI calls; verify it works in local Worker preview, otherwise replace with an explicit `AbortController` timeout.
- `[ ]` `astro:env/server` imports are used for secrets; verify they resolve from Worker secrets in staging and production.

## Phase 3 - Local Worker Verification

- `[ ]` Run dependency install on the migration branch.
- `[ ]` Run `npm run lint`.
- `[ ]` Run `npm run build`.
- `[ ]` Run `npm run preview` and verify it uses the Cloudflare Worker runtime path for the selected adapter.
- `[ ]` Run local smoke checks:
  - `/` returns 200.
  - `/auth/signin` returns 200.
  - `/dashboard` redirects unauthenticated users to `/auth/signin`.
  - Static assets load with hashed URLs.
  - Vue islands hydrate on `/game` and dashboard widgets.
- `[ ]` Run authenticated smoke checks against staging/local Supabase:
  - Sign up or sign in.
  - Session cookie persists across navigation.
  - Protected pages load after sign-in.
  - Sign out clears the session.
- `[ ]` Run API smoke checks:
  - Categories list/create/update/delete.
  - Tags list/create/update/delete.
  - Sessions list/create/update.
  - Questions list/create/update/delete.
  - Dashboard stats endpoints.
- `[ ]` Run AI smoke checks only with capped keys:
  - One small Google generation request.
  - One small OpenRouter request if used.
  - Provider 4xx path returns a user-safe error.
  - Provider timeout path does not leave a permanently pending generation batch.

Support steps:

- `[ ]` If Supabase auth cookies fail, inspect `Set-Cookie` attributes and redirect URL configuration first.
- `[ ]` If local preview passes but deployed Worker fails, check secrets and compatibility date before changing code.
- `[ ]` If AI requests time out at 60 seconds, add a smaller test model and use it for deployment validation.

## Phase 4 - External Integration Setup

### Cloudflare

- `[ ]` Authenticate Wrangler locally with the intended Cloudflare account.
- `[ ]` Set `CLOUDFLARE_ACCOUNT_ID` locally or in CI, not in source.
- `[ ]` Create the Worker configuration only after the adapter version gate is resolved.
- `[ ]` Keep sensitive values out of `wrangler.jsonc`; use Wrangler secrets.
- `[ ]` Create/set Worker secrets:
  - `SUPABASE_URL`
  - `SUPABASE_KEY`
  - `OPENROUTER_API_KEY`
  - `GOOGLE_API_KEY`
- `[ ]` Recommended initial secret commands:
  - `npx wrangler secret put SUPABASE_URL`
  - `npx wrangler secret put SUPABASE_KEY`
  - `npx wrangler secret put OPENROUTER_API_KEY`
  - `npx wrangler secret put GOOGLE_API_KEY`
- `[ ]` If using staging and production as separate Workers/environments, set secrets separately for each target.
- `[ ]` Avoid bulk secret upload from `.env.production` until the first manual secret setup is proven; it is easy to upload the wrong environment file.
- `[ ]` Confirm required secrets cause deploy validation to fail when missing.
- `[ ]` Enable preview URLs only after Access policy is ready if the app must remain private.
- `[ ]` Configure Cloudflare Access for preview/staging URLs before sharing links.

### Supabase

- `[ ]` Add production Worker URL to Supabase Auth Site URL / redirect allowlist.
- `[ ]` Add staging Worker URL to Supabase Auth redirect allowlist.
- `[ ]` Add preview URL pattern only if needed and only if the allowlist policy is acceptable.
- `[ ]` Verify email confirmation links return to the Cloudflare-hosted app.
- `[ ]` Verify RLS policies with a real authenticated user on production/staging.
- `[ ]` Verify Storage bucket access for `quiz-images` if image paths become active in production.

### Supabase Local-to-Online Integration

Goal: local Supabase remains the default development runtime; the hosted Supabase project receives schema changes only through reviewed migrations.

- `[ ]` Treat the linked remote project as a schema deployment target, not the default local app backend.
- `[ ]` Keep local `.env` using local Supabase values from `npx supabase status`.
- `[ ]` Keep hosted Supabase values out of `.env` unless intentionally testing against staging/production.
- `[ ]` Use separate uncommitted files if needed:
  - `.env` for local Supabase.
  - `.env.staging.local` for staging Supabase.
  - `.env.production.local` for production Supabase.
- `[ ]` Confirm `.gitignore` excludes all `.env*` files that may contain hosted secrets; current `.gitignore` excludes `.env` and `.env.production`, but should also exclude `.env.local`, `.env.*.local`, and `.dev.vars*` before adding Cloudflare/Supabase secret files.
- `[ ]` Link the repository to the remote project:
  - `npx supabase login`
  - `npx supabase link --project-ref <project-ref>`
- `[ ]` If the hosted project already has schema changes made through the dashboard, baseline them before pushing new migrations:
  - `npx supabase db pull`
  - Review the generated `supabase/migrations/<timestamp>_remote_schema.sql`.
  - Commit the reviewed migration.
  - Run `npx supabase db reset` locally to prove the migration chain rebuilds from scratch.
- `[ ]` Check migration state before every remote push:
  - `npx supabase migration list`
- `[ ]` Preview remote migration application before applying:
  - `npx supabase db push --dry-run`
- `[ ]` Apply migrations first to staging, then production:
  - `npx supabase db push`
- `[ ]` Only one person or one CI job should run `db push` against a given hosted project at a time.
- `[ ]` Never make production schema changes directly in Supabase Dashboard once migrations are active; direct dashboard changes bypass migration history and can break future `db push`.
- `[ ]` Generate TypeScript database types after local reset or remote migration:
  - Local-first: `npx supabase gen types typescript --local --schema public`
  - Remote verification only: `npx supabase gen types typescript --linked --schema public`
- `[ ]` Update `src/db/database.types.ts` only from a known-good schema source and review the diff.

Auth and redirect configuration:

- `[ ]` Keep local auth settings in `supabase/config.toml` for the local stack:
  - local `site_url`: `http://127.0.0.1:3000`
  - local redirect URLs include local dev URLs only.
- `[ ]` Configure hosted Supabase Auth URLs for deployed Cloudflare URLs:
  - staging Worker URL.
  - production `workers.dev` URL.
  - final custom domain.
- `[ ]` Use `npx supabase config push` only after reviewing which `config.toml` settings should affect the hosted project. Do not blindly push local auth settings to production because local `site_url` and redirect URLs are development-specific.
- `[ ]` Prefer manual dashboard changes for first production Auth URL setup if there is any uncertainty, then codify only stable config afterward.

Storage integration:

- `[ ]` If `quiz-images` is needed at launch, define the bucket in `supabase/config.toml` instead of relying on dashboard-only setup.
- `[ ]` Pull storage schema/policies if the hosted project already has storage policies:
  - `npx supabase db pull --schema storage`
- `[ ]` Do not sync production bucket objects into git. Seed only small, non-sensitive test assets.
- `[ ]` Use `npx supabase seed buckets` only for intentional test/staging bucket seeding.

Remote data policy:

- `[ ]` Migrations define schema, RLS, functions, indexes, and policies.
- `[ ]` Seeds are for local or staging fixtures unless explicitly approved for production.
- `[ ]` Never dump production user data into local files without an explicit privacy review.
- `[ ]` If production-like data is needed locally, create anonymized fixtures or hand-written seed rows.

Support steps:

- `[ ]` If `db push` reports migration history drift, stop and run `npx supabase migration list`; do not use `migration repair` until the actual schema state is understood.
- `[ ]` If remote changes were made manually, run `npx supabase db pull`, review/commit the generated migration, and resume migration-only workflow.
- `[ ]` If `db pull` fails on permission errors in platform-managed schemas, follow Supabase's documented permission fix or narrow the pulled schema.
- `[ ]` If local and hosted Postgres versions differ, align `supabase/config.toml` `[db].major_version` with the hosted project before relying on local migration tests.
- `[ ]` If auth works locally but not online, inspect hosted Supabase Auth URL settings before changing application code.

### OpenRouter and Google

- `[ ]` Set hard spend limits or quota controls before production deploy.
- `[ ]` Align OpenRouter `HTTP-Referer` with the production domain. Current code hardcodes `https://vartownik.app`.
- `[ ]` Decide whether `HTTP-Referer` and `X-Title` should become env-driven config before custom-domain cutover.
- `[ ]` Keep provider keys separate between staging and production if possible.
- `[ ]` Add manual provider status check to the launch checklist.

Support steps:

- `[ ]` If Supabase redirects return to localhost or the wrong domain, fix Supabase Auth URL settings before debugging Astro.
- `[ ]` If provider requests are rejected, check provider key scope, allowed referrer/domain settings, and spend caps before changing fetch code.
- `[ ]` If preview URLs are not acceptable for privacy, deploy a named staging Worker instead of relying on ephemeral previews.

## Phase 5 - Staging Deployment

- `[ ]` Deploy to a staging Worker or environment before production.
- `[ ]` Confirm staging uses staging secrets.
- `[ ]` Run the full smoke checklist from Phase 3 against the staging URL.
- `[ ]` Verify Worker logs/observability for the staging Worker.
- `[ ]` Confirm preview URL limitations: use preview URLs for validation, not deep debugging, because the infrastructure research identified weaker logging for previews.
- `[ ]` Capture deployed version/URL in this plan after deployment.

Support steps:

- `[ ]` If logs are not available for the surface being tested, reproduce on the named staging Worker.
- `[ ]` If static assets fail, inspect generated asset config and Worker asset routing before changing application routes.
- `[ ]` If auth works locally but not staging, compare Supabase redirect allowlist, cookie domain behavior, and Worker secret values.

## Phase 6 - Production Deployment

- `[ ]` Human approval: production deploy target, secrets, and domain are confirmed.
- `[ ]` Deploy production Worker with production secrets.
- `[ ]` Run unauthenticated production smoke checks.
- `[ ]` Run authenticated production smoke checks with a test account.
- `[ ]` Run exactly one low-cost AI generation request after confirming spend caps.
- `[ ]` Configure custom domain only after `workers.dev` production smoke checks pass.
- `[ ]` Update Supabase Auth URLs to the final custom domain.
- `[ ]` Re-run auth/email-confirmation smoke tests after domain cutover.
- `[ ]` Record production URL, Worker name, compatibility date, adapter version, and deploy command used.

Support steps:

- `[ ]` If production fails before custom domain cutover, rollback the Worker and keep the old hosting path active.
- `[ ]` If production fails after custom domain cutover, rollback Worker first; only change DNS/routes if rollback does not restore service.
- `[ ]` If Supabase auth breaks after domain cutover, fix Supabase Auth URLs and retest before rolling back app code.

## Phase 7 - Rollback and Fallback

- `[ ]` Verify `wrangler rollback` works for the Worker.
- `[ ]` Keep the last known-good Node adapter branch or commit available until Cloudflare has been stable.
- `[ ]` Document which external changes are not rolled back by Worker rollback:
  - Supabase migrations/data changes.
  - Supabase Auth URL settings.
  - Provider key rotations.
  - DNS/custom-domain routing.
- `[ ]` Railway fallback trigger: if Cloudflare migration fails because of unresolved runtime compatibility, deploy current Node adapter app to Railway instead of continuing to chase Cloudflare.

Support steps:

- `[ ]` For code-only regressions, rollback Worker deployment.
- `[ ]` For secret/config regressions, fix Worker secrets or Wrangler config and redeploy.
- `[ ]` For Supabase data/schema regressions, stop automated work and require manual database review.

## Phase 8 - Post-Deployment Operations

- `[ ]` Add a deployment runbook section to `README.md` after the first successful deployment.
- `[ ]` Document exact secret names and where they are configured, without secret values.
- `[ ]` Document smoke-test commands and expected responses.
- `[ ]` Add CI/CD only after manual Wrangler deployment is proven stable.
- `[ ]` If GitHub-based Workers Builds are enabled, document build command, deploy command, environment variables, and approval boundary.
- `[ ]` Add recurring dependency checks for Astro, `@astrojs/cloudflare`, Wrangler, Supabase client, and AI provider clients.
- `[ ]` Add a production incident checklist:
  - Check Cloudflare Worker status/logs.
  - Check Supabase status and auth settings.
  - Check OpenRouter/Google provider status and quotas.
  - Check recent deployment version.
  - Roll back only after identifying whether the issue is code, secret, provider, or data-related.

## Acceptance Criteria

- `[ ]` Wrangler CLI is authenticated and verified with `npx wrangler whoami`.
- `[ ]` Supabase CLI is authenticated and linked to the intended hosted project.
- `[ ]` Local `.env` uses local Supabase by default; hosted secrets are only in Cloudflare/Supabase secret stores or uncommitted local files.
- `[ ]` Hosted Supabase migration state is checked with `npx supabase migration list`.
- `[ ]` Remote schema changes are previewed with `npx supabase db push --dry-run` before any real `db push`.
- `[ ]` Cloudflare adapter migration builds locally.
- `[ ]` Local Worker preview passes unauthenticated, authenticated, API, and AI smoke tests.
- `[ ]` Staging Worker passes the same smoke tests.
- `[ ]` Production Worker passes smoke tests before custom domain cutover.
- `[ ]` Custom domain passes smoke tests after Supabase Auth URLs are updated.
- `[ ]` Rollback path is verified.
- `[ ]` External integrations have documented support steps and manual owners.

## Reference Checks

- Astro Cloudflare adapter docs: https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- Cloudflare Astro Workers guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/
- Wrangler configuration docs: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare Workers best practices: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Node.js compatibility docs: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare Worker secrets docs: https://developers.cloudflare.com/workers/configuration/secrets/
- Wrangler general commands docs: https://developers.cloudflare.com/workers/wrangler/commands/general/
- Supabase local development docs: https://supabase.com/docs/guides/local-development/overview
- Supabase database migrations docs: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase environment management docs: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase CLI config docs: https://supabase.com/docs/guides/local-development/cli/config
