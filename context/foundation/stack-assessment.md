---
project: vartownik (10x-astro-starter)
assessed_at: 2026-05-19T00:00:00Z
agent_readiness: ready-with-compensation
context_type: brownfield
stack_components:
  language: TypeScript 5
  framework: Astro 5 (SSR) + Vue 3 (Composition API islands)
  build_tool: Vite (embedded via Astro)
  test_runner: null
  package_manager: npm
  ci_provider: null
  deployment_target: Node.js standalone (@astrojs/node)
gates_passed: 7
gates_failed: 1
---

## Stack Components

**Language — TypeScript 5** (`typescript ^5.9.3`). Strict mode is enabled via `"extends": "astro/tsconfigs/strict"` in `tsconfig.json`. The ESLint configuration (`eslint.config.js`) additionally enforces `tseslint.configs.strict` and `tseslint.configs.stylistic`, making type-unsafe patterns a linting error. The path alias `@/*` → `./src/*` is configured in `tsconfig.json`.

**Framework — Astro 5 + Vue 3** (`astro ^5.13.7`, `vue ^3.5.30`, `@astrojs/vue ^5.1.4`). The app runs in full SSR mode (`output: "server"`) with the Node.js adapter (`@astrojs/node ^9.4.3`). Vue 3 is used exclusively for interactive islands (Composition API, `<script setup lang="ts">`). State is shared between islands via Nano Stores (`nanostores ^1.1.1`, `@nanostores/vue ^1.1.0`). UI components come from shadcn-vue (`radix-vue ^1.9.17`, `reka-ui ^2.9.7`). Tailwind 4 is integrated via the Vite plugin (`@tailwindcss/vite ^4.2.1`). Supabase (`@supabase/ssr ^0.9.0`, `@supabase/supabase-js ^2.99.1`) handles auth and database.

**Build tool — Vite (embedded in Astro)**. Astro manages the Vite configuration. Tailwind 4 hooks in as a Vite plugin. No separate `vite.config.*` file exists; all Vite config lives in `astro.config.mjs`.

**Test runner — not detected**. No `vitest.config.*`, `jest.config.*`, or `playwright.config.*` was found. No `test` script exists in `package.json`. No testing dependencies are present in `devDependencies`.

**Package manager — npm** (`package-lock.json` present).

**CI/CD — not detected**. No `.github/workflows/`, `.gitlab-ci.yml`, or other CI config was found.

**Deployment — Node.js standalone**. The `@astrojs/node` adapter in standalone mode produces a self-contained Node.js server. No `Dockerfile`, `fly.toml`, `vercel.json`, or other platform-specific deployment config was found.

**Instruction files** — rich and granular:
- `CLAUDE.md` — Claude-specific project rules
- `AGENTS.md` — general agent rules (same content as CLAUDE.md)
- `.github/copilot-instructions.md` — Copilot-specific rules
- `.github/instructions/general-project-setup.instructions.md` — global conventions
- `.github/instructions/astro-guidelines.instructions.md` — Astro-specific rules
- `.github/instructions/frontend-guidelines.instructions.md` — Vue/Astro frontend rules
- `.github/instructions/vue-best-practices.instructions.md` — Vue 3 specific
- `.github/instructions/backend-supabase.instructions.md` — Supabase/API rules
- `.github/instructions/db-migrations.instructions.md` — migration conventions
- `.github/instructions/shadcn-components.instructions.md` — UI component rules

---

## Quality Gate Assessment

```
| Component    | Typed | Convention | Training Data | Documented | Verdict       |
|--------------|-------|------------|---------------|------------|---------------|
| Language     |  ✓    |    —       |      —        |    —       |  pass         |
| Framework    |  —    |    ✓       |      ✓        |    ✓       |  pass         |
| Build tool   |  —    |    ✓       |      ✓        |    ✓       |  pass         |
| Test runner  |  —    |    ✗       |      —        |    —       |  fail (absent)|

Legend: ✓ = pass, ✗ = fail, — = not applicable
```

### Gate Details

#### Type safety — PASS

**Evidence**: `tsconfig.json` line 2: `"extends": "astro/tsconfigs/strict"`. The `astro/tsconfigs/strict` preset enables `strict: true`, `strictNullChecks: true`, `noImplicitAny: true`, and related flags. Additionally, `eslint.config.js` applies `tseslint.configs.strict` (errors on any unsafe type operations) and `tseslint.configs.stylistic` (enforces consistent type usage). All source files use `.ts` / `.vue` with `lang="ts"` / `.astro`. No plain JavaScript files found in `src/`.

#### Conventions — PASS (Framework + Build tool)

**Evidence**: Astro enforces file-based routing (`src/pages/` → URL paths, `src/pages/api/` → API endpoints). Island architecture is enforced by framework design (`client:*` directives, only `.vue` files get interactivity). The project follows and documents the directory conventions in `.github/instructions/general-project-setup.instructions.md` (layouts in `src/layouts/`, pages in `src/pages/`, services in `src/lib/services/`, shared types in `src/types.ts`, etc.). Vue `<script setup lang="ts">` usage is enforced by `eslint-plugin-vue` flat/recommended config. Vite configuration is fully abstracted by Astro.

**Test runner**: No test runner present, so no testing conventions exist anywhere in the project. The `package.json` `scripts` block has no `test` entry.

#### Popular in training data — PASS (Framework + Build tool)

**Evidence**: Assessed within the JS/TS language family. Astro 5 is a mainstream framework with a large, active community, extensive official documentation, thousands of public GitHub repos, and broad Stack Overflow coverage. Vue 3 is the third most-used JS UI framework globally, with multi-year training-data presence. Vite is the dominant JS build tool since 2022. All three pass within the JS/TS family context.

#### Documentation quality — PASS (Framework + Build tool)

**Evidence**: Astro documentation at `docs.astro.build` is versioned, comprehensive, and actively maintained. Vue 3 documentation at `vuejs.org` is exemplary — versioned, example-rich, and well-structured. Vite documentation at `vitejs.dev` is versioned and includes migration guides per major version. Supabase documentation at `supabase.com/docs` is comprehensive with TypeScript examples. Tailwind v4 documentation at `tailwindcss.com/docs` reflects the current major version.

---

## Gaps & Compensation

### Gap 1 — No test runner configured (Convention-based: fail)

**What failed**: No test runner exists in the project. `package.json` has no `test` script. No `vitest.config.*`, `jest.config.*`, or `playwright.config.*` file was found. No testing dependencies (`vitest`, `@testing-library/vue`, `playwright`, etc.) are installed.

**Why it matters for agent workflows**: When an agent writes code or modifies existing logic, it cannot run tests to verify correctness. The agent also cannot generate test files that follow project conventions because no conventions exist. Without a test layer, the agent's feedback loop is limited to linting and type checking only — catching structural errors but not behavioral regressions.

**Compensation strategy**: Add Vitest (the natural companion for Vite/Astro projects) plus `@testing-library/vue` for Vue component tests. This is the lowest-friction choice — Vitest shares Vite's config and works out of the box with the existing setup.

### Gap 2 — No CI/CD pipeline (secondary gap, not a gate failure)

**What's missing**: No GitHub Actions workflows, GitLab CI, or other CI configuration detected.

**Why it matters**: Without CI, the agent has no automated quality gate to verify that changes don't break the build. The pre-commit hooks (husky + lint-staged) provide local protection, but nothing runs on push or PR.

---

### Recommended Instruction File Additions

Add the following to `AGENTS.md` and `CLAUDE.md` (or create a dedicated `.github/instructions/testing.instructions.md`):

---

**Testing conventions (add after test runner is installed):**

```markdown
## Testing

- Test runner: Vitest (`npm test` or `npx vitest`)
- Unit/component tests live next to the source file: `src/components/auth/SignInForm.test.ts`
- Vue component tests use `@testing-library/vue` (`render`, `fireEvent`, `screen`)
- Do NOT use `describe` nesting deeper than 2 levels
- Test file naming: `<ComponentName>.test.ts` for components, `<service>.service.test.ts` for services
- Run tests before committing: `npm test -- --run`
- Astro page logic should be tested through the service layer, not through Astro page rendering
```

**CI/CD conventions (add when GitHub Actions is configured):**

```markdown
## CI/CD

- CI provider: GitHub Actions (`.github/workflows/`)
- CI must pass: `npm run lint`, `npm run build`, `npm test -- --run`
- PRs require CI green before merge
- Secrets: `SUPABASE_URL`, `SUPABASE_KEY` are stored as GitHub Actions secrets, not hardcoded
```

---

## Summary

**Overall agent-readiness: ready-with-compensation.**

**Key strengths:**
- Excellent type safety: TypeScript strict mode across the entire codebase, enforced by both tsc and ESLint.
- Strong conventions: Astro's file-based routing and island architecture give the agent a predictable map of the project. The granular instruction files (10 files across different concerns) are above-average context for agent workflows.
- High-quality, well-documented stack: Astro 5, Vue 3, Vite, Supabase, and Tailwind 4 all have excellent official documentation that the agent can reference accurately.
- Popular within the JS/TS ecosystem: all major components have strong training-data coverage.

**Key gaps:**
- No test runner: the single failing gate. The agent cannot run tests, cannot generate tests following project conventions, and has no behavioral safety net beyond type checking and linting.
- No CI/CD: a secondary gap that doesn't fail a quality gate but limits the automated feedback loop on pushed changes.

**Recommended next steps:**
1. Install Vitest + `@testing-library/vue` and add the testing conventions above to instruction files.
2. Add a minimal GitHub Actions workflow (`npm run lint && npm run build && npm test -- --run`).
3. Run `/10x-health-check` to surface any additional dependency, security, or configuration issues.
