---
applyTo: "**"
---
# General Project Setup & Coding Standards

You are an expert full-stack developer working with Astro 5, Vue 3, TypeScript, and Supabase.

These rules apply globally to all files in this project.

## Tech Stack

- Astro 5 (SSR, `output: "server"`, adapter: `@astrojs/node`)
- TypeScript 5
- Vue 3 (Composition API, `<script setup>`) — interactive islands
- Tailwind 4
- shadcn-vue + Radix Vue — UI components
- Nano Stores (`nanostores` + `@nanostores/vue`) — lightweight state manager between islands
- Supabase (PostgreSQL + pgvector, Auth, Storage, Edge Functions)
- lucide-vue-next — icons

## TypeScript Usage

- Always use TypeScript for all code.
- Always enable strict mode in `tsconfig.json`.
- Always use explicit types for function parameters and return values.

## Project Structure

Always follow this directory structure when introducing changes:

- `./src` — source code
- `./src/layouts` — Astro layouts
- `./src/pages` — Astro pages
- `./src/pages/api` — API endpoints
- `./src/middleware/index.ts` — Astro middleware
- `./src/db` — Supabase clients and types
- `./src/types.ts` — Shared types for backend and frontend (Entities, DTOs)
- `./src/components` — Astro components (static) and Vue 3 (interactive islands)
- `./src/components/ui` — UI components from shadcn-vue
- `./src/composables` — Vue composables (extracted logic, hooks)
- `./src/stores` — Nano Stores (shared state between Vue islands)
- `./src/lib` — Services and helpers
- `./src/assets` — static internal assets
- `./public` — public assets

When modifying the directory structure, always update this section.

## Clean Code Guidelines

- Always use feedback from linters to improve code when making changes.
- Always prioritize error handling and edge cases.
- Always handle errors and edge cases at the beginning of functions.
- Always use early returns for error conditions to avoid deeply nested `if` statements.
- Always place the happy path last in the function for improved readability.
- Never use unnecessary `else` statements; use the `if`-`return` pattern instead.
- Always use guard clauses to handle preconditions and invalid states early.
- Always implement proper error logging and user-friendly error messages.
- Consider using custom error types or error factories for consistent error handling.

## Naming Conventions

- Variables and functions: `camelCase`
- Classes and components: `PascalCase`
- Constants: `UPPER_CASE`
- Interfaces: `PascalCase` (avoid the `I` prefix unless necessary)
