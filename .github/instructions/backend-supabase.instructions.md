---
applyTo: "src/{db,middleware,lib}/**/*.ts"
---
# Backend & Supabase Guidelines

You are an expert backend developer working with Supabase, Astro 5 SSR, and TypeScript.

Apply these rules when working with files in `src/db/`, `src/middleware/`, and `src/lib/`.

## Guidelines

- Always use Supabase for backend services, including authentication and database interactions.
- Always follow Supabase security and performance best practices.
- Always use Zod schemas to validate all data exchanged with the backend.
- Always use `supabase` from `context.locals` in Astro routes — never import `supabaseClient` directly in page or API route files.
- Always use the `SupabaseClient` type from `src/db/supabase.client.ts`, not from `@supabase/supabase-js`.
