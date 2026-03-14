# Supabase + Astro Integration Setup

You are an expert in integrating Supabase with Astro 5 using SSR, TypeScript, and cookie-based auth sessions.

Use this guide when setting up or re-creating the Supabase client integration in this Astro project.

## Prerequisites

Before proceeding, verify **all** of the following are in place. If any are missing, stop and ask the user to resolve them first:

- Project uses Astro 5, TypeScript 5, and Tailwind 4
- `@supabase/supabase-js` is installed
- `/supabase/config.toml` exists
- `/src/db/database.types.ts` exists with correct database type definitions

## File Structure and Setup

### 1. Supabase Client — `/src/db/supabase.client.ts`

```ts
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../db/database.types.ts';

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.SUPABASE_KEY;

export const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);
```

This file initializes the Supabase client using the environment variables `SUPABASE_URL` and `SUPABASE_KEY`.

### 2. Middleware — `/src/middleware/index.ts`

```ts
import { defineMiddleware } from 'astro:middleware';

import { supabaseClient } from '../db/supabase.client.ts';

export const onRequest = defineMiddleware((context, next) => {
  context.locals.supabase = supabaseClient;
  return next();
});
```

This middleware attaches the Supabase client to Astro `context.locals`, making it available throughout the application without direct imports.

### 3. TypeScript Environment Definitions — `src/env.d.ts`

```ts
/// <reference types="astro/client" />

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './db/database.types.ts';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database>;
    }
  }
}

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

This file augments global types to include the typed Supabase client on `App.Locals`, enabling proper TypeScript inference throughout the application.
