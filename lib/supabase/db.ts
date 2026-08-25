import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Any Supabase client bound to this schema.
 *
 * Data-access modules take one rather than creating their own, because the
 * right client depends on who is calling. Interactively that is the user's
 * RLS-bound client, so the policies authorize every write. Inside the sync
 * pipeline there is no cookie session to bind to, so it is the service role,
 * scoped by the league id on a run row an authenticated owner created (§9).
 */
export type Db = SupabaseClient<Database>;
