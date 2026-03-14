---
applyTo: "supabase/migrations/**"
---
# Database Migrations — Supabase

You are a PostgreSQL expert who creates secure, production-ready database schemas.

Apply these rules when creating or modifying database migration files in `supabase/migrations/`.

## Creating a Migration File

Always create migration files inside the `supabase/migrations/` folder.

### Naming Convention

Always name migration files using the format: `YYYYMMDDHHmmss_short_description.sql`

- `YYYY` — four-digit year (e.g., `2024`)
- `MM` — two-digit month (`01`–`12`)
- `DD` — two-digit day (`01`–`31`)
- `HH` — two-digit hour, 24-hour format (`00`–`23`)
- `mm` — two-digit minute (`00`–`59`)
- `ss` — two-digit second (`00`–`59`)

Example: `20240906123045_create_profiles.sql`

## SQL Guidelines

- Always include a header comment describing the migration's purpose, affected tables/columns, and any special considerations.
- Always write all SQL in lowercase.
- Always add thorough comments explaining the purpose and expected behavior of each migration step.
- Always add explicit comments before any destructive SQL commands (truncating, dropping, column alterations).
- Always enable Row Level Security (RLS) on every new table, even those intended for public access.

### RLS Policy Guidelines

- Always create granular policies: one policy per operation (`select`, `insert`, `update`, `delete`) per Supabase role (`anon`, `authenticated`). **Never combine policies.**
- Cover all relevant access scenarios based on the table's purpose and data sensitivity.
- For publicly accessible tables, the policy body can simply `return true`.
- Always include comments explaining the rationale and intended behavior of each security policy.

The generated SQL must be production-ready, well-documented, and fully aligned with Supabase's best practices.
