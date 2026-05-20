---
project: vartownik (10x-astro-starter)
checked_at: 2026-05-20T00:00:00Z
health_status: needs-attention
context_type: brownfield
language_family: js
stack_assessment_available: true
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 0
  moderate: 7
  low: 3
test_runner_detected: false
ci_provider: null
recommended_fixes: 3
---

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

Lockfile is present and up to date. Dependency versions are pinned — reproducible builds are guaranteed.

### Security Audit

```
Tool: npm audit --json
Summary: 0 CRITICAL, 0 HIGH, 7 MODERATE, 3 LOW
Direct vs transitive: 3 direct (astro, @astrojs/node, @astrojs/check), 7 transitive
```

``npm update`` was run prior to this check and resolved all 10 previous HIGH findings by advancing ``astro`` from ``5.13.7`` to ``5.18.1``. No HIGH or CRITICAL advisories remain. The remaining findings either require a semver-major upgrade to the astro v6 ecosystem, or affect the dev toolchain only.

MODERATE findings (7):

- **astro** ``<=6.1.9`` (direct) — XSS in ``define:vars`` via incomplete ``</script>`` sanitization (GHSA-j687-52p2-xcff, CVSS 6.1), Server island encrypted parameters cross-component replay (GHSA-xr5h-phrj-8vxv, CVSS 6.1). Fix: requires upgrade to ``astro@6.x`` (breaking change — see outdated deps section).
- **@astrojs/node** ``<=10.0.4`` (direct) — Memory exhaustion DoS due to missing request body size limit in Server Islands (GHSA-3rmj-9m5h-8fpv, CVSS 5.9), Cache Poisoning via malformed ``if-match`` header (GHSA-c57f-mm3j-27q9, CVSS 5.3). Fix: requires upgrade to ``@astrojs/node@10.1.1`` (semver-major, paired with astro v6 upgrade).
- **@astrojs/check** ``>=0.9.3`` (direct, dev toolchain) — transitive via ``@astrojs/language-server`` → ``volar-service-yaml``. **Dev toolchain only.** Fix: downgrade to ``@astrojs/check@0.9.2`` or await a patch release.
- **volar-service-yaml** / **yaml-language-server** / **yaml** (transitive, dev toolchain) — DoS via deeply nested YAML collections (CVSS 4.3). All three flow from the ``@astrojs/language-server`` used in editor integration. **Dev toolchain only — no production impact.** Fix: resolved when ``@astrojs/check`` is patched.

LOW findings (3):

- **@astrojs/vue** ``<=5.1.4`` (direct) — advisory inherited from ``astro``. Fix: requires ``@astrojs/vue@6.x`` paired with astro v6 upgrade.
- **eslint** ``9.10.0–9.26.0`` (direct, dev toolchain) — ReDoS via ``@eslint/plugin-kit`` (GHSA-xffm-g5w8-qvg7). Fix: ``npm install eslint@9.39.4`` — minor version update, no breaking change.
- **@eslint/plugin-kit** ``<0.3.4`` (transitive via eslint, dev toolchain) — same ReDoS as above.

### Outdated Dependencies

```
Packages with major version gaps (1 major behind): 5
```

No packages are 2 or more major versions behind. The following are 1 major version behind:

- **astro**: ``5.18.1`` → ``6.3.6`` — upgrading resolves the remaining MODERATE findings but is a breaking change requiring coordinated updates to ``@astrojs/node`` and ``@astrojs/vue``
- **@astrojs/node**: ``9.5.5`` → ``10.1.1`` — paired with astro v6
- **@astrojs/vue**: ``5.1.4`` → ``6.0.1`` — paired with astro v6
- **typescript**: ``5.9.3`` → ``6.0.3`` — TypeScript 6 just released; check migration notes before upgrading
- **eslint**: ``9.23.0`` → ``10.4.0`` — major; hold until the plugin ecosystem catches up
- **lucide-vue-next**: ``0.577.0`` → ``1.0.0`` — initial stable release; check for API changes

---

## Test Suite

```
Test runner: not detected
Tests found: not applicable
Test execution: not attempted
```

⚠ No test runner detected. The agent cannot verify its own changes.

No ``vitest.config.*``, ``jest.config.*``, or ``playwright.config.*`` was found. The ``package.json`` ``scripts`` block has no ``test`` entry. No testing dependencies (``vitest``, ``@testing-library/vue``, ``playwright``, etc.) are present in ``devDependencies``.

**Recommended**: Vitest is the natural companion for this Vite/Astro/Vue stack — it shares Vite's configuration and has first-class Vue component testing support via ``@testing-library/vue``.

---

## CI/CD

```
Provider: not detected
Configuration: not found
```

ℹ No CI/CD configuration detected. You will set this up in the infrastructure and deployment lesson.
For now, a local test runner is sufficient for agent collaboration.

| Stage      | Status | Notes                                         |
|------------|--------|-----------------------------------------------|
| Lint       | ✗      | not configured in CI (local: npm run lint)    |
| Test       | ✗      | not configured in CI (no test runner)         |
| Build      | ✗      | not configured in CI (local: npm run build)   |
| Type check | ✗      | not configured in CI (local: npx astro check) |
| Security   | ✗      | not configured in CI                          |

Note: husky + lint-staged provides local pre-commit protection (ESLint + Prettier on staged files). This is solid local hygiene — CI is the next layer.

---

## Configuration

All critical configuration files are present. One low-severity gap found.

### Low severity

- **.editorconfig** — absent. Without it, editors that do not auto-detect the project's formatting preferences may introduce whitespace noise. The ESLint + Prettier setup handles this at lint time, but .editorconfig prevents the diffs in the first place. Fix: create a minimal .editorconfig (quick, < 5 min).

### Present and healthy

- tsconfig.json extends astro/tsconfigs/strict — TypeScript strict mode enforced
- eslint.config.js — flat config with tseslint.configs.strict, tseslint.configs.stylistic, eslint-plugin-vue, eslint-plugin-astro, and eslint-plugin-prettier/recommended
- Prettier — configured via eslint-plugin-prettier/recommended; prettier-plugin-astro is auto-discovered by Prettier v3
- husky + lint-staged — pre-commit hooks run eslint --fix on *.{ts,vue,astro} and prettier --write on *.{json,css,md}
- .gitignore — present
- .env.example — present
- AGENTS.md — present and granular (10 instruction files covering project setup, Astro, Vue, Supabase, migrations, shadcn conventions)

---

## Stack Assessment Cross-Reference

```
Stack assessment: context/foundation/stack-assessment.md
Agent readiness (from stack-assess): ready-with-compensation
```

| Quality Gate Gap                          | Health-Check Finding                                                    | Status      |
|-------------------------------------------|-------------------------------------------------------------------------|-------------|
| test_runner: fail (absent)                | Confirmed — no test runner, no test script, no testing dependencies     | Reinforced  |
| ci_provider: null (secondary gap)         | Confirmed — no CI configuration found                                   | Reinforced  |
| Compensation strategy: add Vitest         | No Vitest installed yet — the compensation is recommended but not done  | Gap open    |
| Compensation: AGENTS.md entries           | AGENTS.md present and rich — instruction files cover all major areas    | Mitigated   |

The stack assessment identified adding Vitest as the primary compensation action for the missing test runner gate. Health-check confirms it has not been installed yet. This is the highest-priority action before beginning agent-assisted feature development.

---

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Install a test runner (Vitest)

**Impact**: Without tests, the agent operates blind — it can generate code and pass lint/type checks, but cannot verify behavioral correctness. The agent will also produce test files of inconsistent style because no testing conventions exist yet. This is the single change with the highest leverage on agent workflow quality.
**Severity**: high
**Effort**: moderate (15–30 min)
**Fix**:

Run: npm install -D vitest @testing-library/vue @vue/test-utils jsdom

Add to package.json scripts: "test": "vitest run" and "test:watch": "vitest"

Create vitest.config.ts:

  import { defineConfig } from 'vitest/config';
  import vue from '@vitejs/plugin-vue';

  export default defineConfig({
    plugins: [vue()],
    test: {
      environment: 'jsdom',
      globals: true,
    },
  });

Then add a first test to validate the setup, e.g. src/lib/utils.test.ts testing the cn() helper.

---

### 2. Update eslint to fix the LOW ReDoS advisory

**Impact**: The current eslint@9.23.0 carries a ReDoS via @eslint/plugin-kit. While the risk is low and dev-only, resolving it keeps npm audit output noise-free — important for the agent, which should be able to interpret audit results clearly.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**: Run npm install eslint@9.39.4, then verify with npm run lint. This is a minor version update — no breaking changes.

---

### 3. Plan the Astro v6 upgrade (remaining MODERATE production findings)

**Impact**: The MODERATE findings in astro (XSS in define:vars) and @astrojs/node (Cache Poisoning, Memory exhaustion DoS) are fixed in the v6 line. Not urgent for a dev-phase project, but should be scheduled before production launch.
**Severity**: medium
**Effort**: significant (> 1 hour)
**Fix**: Review the Astro v6 upgrade guide at docs.astro.build/en/guides/upgrade-to/v6/ then run: npm install astro@^6 @astrojs/node@^10 @astrojs/vue@^6 and fix any breaking changes with npm run build.

---

### Addressed in upcoming lessons (Category B)

### CI/CD pipeline

**Lesson**: Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)
https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5
**What you will do there**: Set up GitHub Actions workflows for lint, test, build, and type-check gates on push and pull request events.

---

## Summary

```
Health status: needs-attention
```

The dependency health improved significantly — npm update eliminated all 10 previous HIGH findings by advancing astro to 5.18.1. The audit now shows 0 CRITICAL, 0 HIGH, 7 MODERATE, and 3 LOW. The remaining MODERATEs require the astro v6 upgrade path (a planned, breaking migration) or are confined to the dev language-server toolchain with no production impact. The one actionable quick fix is npm install eslint@9.39.4 for a low-risk ReDoS advisory.

The primary blocker for agent-assisted development is unchanged: no test runner is installed. Without Vitest, the agent cannot verify its own changes and no testing conventions exist for it to follow. Once Vitest is in place, this project is well-positioned for the agent onboarding lesson — the instruction file foundation is already in excellent shape.

Next step: install Vitest (Fix 1), then npm install eslint@9.39.4 (Fix 2). Schedule the Astro v6 migration before production launch.
