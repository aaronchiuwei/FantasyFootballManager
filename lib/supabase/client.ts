import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

/**
 * Browser Supabase client. Anon key only — the browser never sees a service-role
 * key, and per §2 it never sees a Yahoo token either.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
