---
applyTo: "**/*.vue"
---
# Vue 3 Best Practices

You are an expert Vue 3 developer using the Composition API, TypeScript, shadcn-vue, and Nano Stores.

Apply these rules when working with `.vue` files.

## Architecture

- Always prefer Composition API (`<script setup>` and composables) over Options API.
- Organize components and composables by feature/domain; separate presentational from container components.
- Always extract reusable logic into `src/composables/`.
- Always share state between islands using Nano Stores in `src/stores/`.

## TypeScript

- Always use `<script setup lang="ts">` with `defineProps`/`defineEmits`.
- Define types for events, refs, and router hooks; use interfaces/aliases for complex shapes.

## Components

- Keep components small and focused on a single responsibility.
- Always use PascalCase for component names and kebab-case for filenames.
- Always validate props via TypeScript; prefer slots/scoped slots over excessive prop drilling.

## State Management

- Use Nano Stores for shared state between islands; use `ref`/`reactive` for local component state.
- Use `computed` for derived state; keep complex data normalized.

## Composition Patterns

- Build reusable composables (e.g., `useAuth`, `useForm`).
- Use `watch`/`watchEffect` carefully with precise dependencies and cleanups.
- Use `provide`/`inject` sparingly; prefer props unless drilling is excessive.

## Styling

- Always use Tailwind CSS; use `<style scoped>` only for small exceptions.
- Use design tokens via CSS variables and Tailwind config; always design mobile-first.

## Data Fetching

- Use `fetch` within composables (e.g., `useApi`).
- Always handle loading, error, and success states explicitly.
- Cancel outdated requests with `AbortController`.

## UI (shadcn-vue)

- Always use shadcn-vue components and extend with Tailwind for customizations.
- Always ensure accessibility (roles/ARIA attributes, keyboard focus management).

## Error Handling

- Define `app.config.errorHandler` globally; use `errorCaptured` locally.
- Always provide user-friendly fallbacks on error.

## Forms & Validation

- Use VeeValidate or similar for form validation.
- Use `v-model` for controlled inputs; debounce search/autosave inputs where needed.

## Security

- Never use `v-html` with untrusted content.
- Always store auth tokens in HTTP-only cookies; never in `localStorage`.

## Performance

- Lazy-load components where possible; use `v-once`/`v-memo` appropriately.
- Avoid redundant watchers; profile with Vue DevTools.

## Accessibility

- Always use semantic HTML with ARIA attributes.
- Always ensure keyboard navigation and WCAG AA contrast ratios.
