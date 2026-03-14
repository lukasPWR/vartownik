# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## Commands

- `npm run dev` — start dev server on port 3000
- `npm run build` — production build (SSR via `@astrojs/node` standalone adapter)
- `npm run preview` — preview production build
- `npm run lint` — ESLint (flat config, eslint.config.js)
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro)

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,vue,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 5 SSR app** with Vue 3 islands (Composition API), Tailwind 4, Supabase auth, shadcn-vue components, and Nano Stores for cross-island state.

### Rendering mode
Full server-side rendering (`output: "server"` in astro.config.mjs). All pages are server-rendered by default. API routes must export `const prerender = false`.

### Auth flow
- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

### Key conventions
- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **Vue 3 components** (`.vue`, `<script setup lang="ts">`) only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn-vue**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn-vue@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies.
- **Vue**: always use `<script setup lang="ts">` and Composition API. Extract reusable logic to composables in `src/composables/`. Share state between islands with Nano Stores in `src/stores/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment
- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env`)
- Local Supabase: `npx supabase start` (requires Docker)
