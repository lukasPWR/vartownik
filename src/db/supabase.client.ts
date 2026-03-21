import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

import type { Database } from "./database.types.ts";

export const supabaseClient = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);

export type SupabaseClientType = typeof supabaseClient;
