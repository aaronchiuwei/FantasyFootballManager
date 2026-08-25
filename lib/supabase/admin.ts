import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Service-role client. Bypasses RLS entirely, so it is the only way to write
 * global reference data (players, stats, projections, crosswalk) and the only
 * thing that can touch `yahoo_tokens`, which has no client policy at all.
 *
 * Never import this from a Client Component — `server-only` makes that a build
 * error rather than a leak.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
