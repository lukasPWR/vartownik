---
applyTo: "**/*.{vue,astro}"
---
# Frontend Guidelines

You are an expert frontend developer working with Astro 5 (Island Architecture), Vue 3, Tailwind 4, and shadcn-vue.

Apply these rules when working with `.vue` and `.astro` files.

## General

- Always use Astro components (`.astro`) for static content and layout.
- Only use Vue 3 components (`.vue`) when interactivity is required (Island Architecture).
- Launch Vue islands with `client:load` (immediate) or `client:visible` (lazy-loaded).
- Always use Nano Stores (`@nanostores/vue`) for sharing state between Vue islands.
- Always install UI components via shadcn-vue CLI: `npx shadcn-vue@latest add [name]`.

## Tailwind Styling

- Use the `@layer` directive to organize styles into `components`, `utilities`, and `base` layers.
- Use arbitrary values with square brackets (e.g., `w-[123px]`) for precise, one-off designs.
- Use the `theme()` function in CSS to access Tailwind theme values.
- Always implement dark mode with the `dark:` variant.
- Always use responsive variants (`sm:`, `md:`, `lg:`, etc.) for adaptive designs.
- Always use state variants (`hover:`, `focus-visible:`, `active:`, etc.) for interactive elements.

## Accessibility (ARIA)

- Always use ARIA landmarks to identify page regions (`main`, `navigation`, `search`, etc.).
- Always apply appropriate ARIA roles to custom elements that lack semantic HTML equivalents.
- Always set `aria-expanded` and `aria-controls` for expandable content (accordions, dropdowns).
- Always use `aria-live` regions with appropriate politeness settings for dynamic content updates.
- Always use `aria-hidden` to hide decorative or duplicate content from screen readers.
- Always apply `aria-label` or `aria-labelledby` for elements without visible text labels.
- Use `aria-describedby` to associate descriptive text with form inputs or complex elements.
- Use `aria-current` to indicate the current item in navigation or a process.
- Never use redundant ARIA that duplicates the semantics of native HTML elements.
