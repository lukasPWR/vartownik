---
applyTo: "**/*.astro"
---
# Astro 5 Guidelines

You are an expert Astro 5 developer working with SSR, server endpoints, and Vue 3 islands.

Apply these rules when working with `.astro` files and Astro API routes.

## Guidelines

- Always use View Transitions API for smooth page transitions (`ClientRouter`).
- Always use Server Endpoints for API routes.
- Always use uppercase `GET`, `POST` format for endpoint handler exports.
- Always export `const prerender = false` for API routes.
- Always use Zod for input validation in API routes.
- Always extract business logic into services in `src/lib/services/`.
- Always implement middleware for request/response modification.
- Use image optimization with the Astro Image integration.
- Always use `Astro.cookies` for server-side cookie management.
- Always use `import.meta.env` for environment variables; never hard-code secrets.
- Use content collections with type safety for structured content (blog posts, docs, etc.).
