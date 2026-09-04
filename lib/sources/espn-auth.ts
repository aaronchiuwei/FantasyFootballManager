import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

import { normalizeSwid } from "./espn-parse";

/**
 * ESPN's half of §2, which is a smaller thing than Yahoo's.
 *
 * There is no OAuth app, no token endpoint and nothing to refresh. A public
 * league answers an anonymous request; a private one wants the two cookies the
 * user's own browser already holds, `SWID` and `espn_s2`. So this module is
 * storage and nothing else — encrypted with the same application-level key as
 * the Yahoo tokens, in a table only the service role can read, and never
 * handed back to the browser.
 *
 * The consequence of cookies-instead-of-tokens is that there is no repair this
 * code can perform on its own. When ESPN stops accepting a pair the only fix
 * is a fresh paste, so `needs_reauth` is set and the UI asks for one.
 */

export class EspnAuthRequired extends Error {
  constructor(
    message = "This ESPN league is private, and the stored cookies are missing or expired.",
  ) {
    super(message);
    this.name = "EspnAuthRequired";
  }
}

export type EspnCookies = { swid: string; espnS2: string };

export type EspnConnection = {
  connected: boolean;
  needsReauth: boolean;
  /** The account id, shown so the user can tell which login is stored. */
  swid: string | null;
  linkedAt: string | null;
};

/**
 * Stores a cookie pair, replacing whatever was there.
 *
 * The SWID is kept in its braced form because that is what ESPN's `owners`
 * arrays hold; comparisons go through `normalizeSwid` rather than relying on
 * the punctuation surviving a round trip through a paste box.
 */
export async function saveEspnCookies(
  userId: string,
  cookies: EspnCookies,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("espn_credentials").upsert(
    {
      user_id: userId,
      swid_enc: encryptSecret(cookies.swid.trim()),
      espn_s2_enc: encryptSecret(cookies.espnS2.trim()),
      needs_reauth: false,
    },
    { onConflict: "user_id" },
  );

  if (error) throw new Error(`Failed to store the ESPN cookies: ${error.message}`);
}

/** The stored pair, or null when the user has never pasted one. */
export async function getEspnCookies(
  userId: string,
): Promise<EspnCookies | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("espn_credentials")
    .select("swid_enc, espn_s2_enc")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the ESPN cookies: ${error.message}`);
  if (!data) return null;

  return {
    swid: decryptSecret(data.swid_enc),
    espnS2: decryptSecret(data.espn_s2_enc),
  };
}

/** The signed-in ESPN account id, for "which of these teams is mine". */
export async function getEspnSwid(userId: string): Promise<string | null> {
  const cookies = await getEspnCookies(userId);
  return cookies ? normalizeSwid(cookies.swid) : null;
}

/** Connection state for the UI. Never returns cookie material. */
export async function getEspnConnection(
  userId: string,
): Promise<EspnConnection> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("espn_credentials")
    .select("swid_enc, needs_reauth, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    connected: Boolean(data),
    needsReauth: data?.needs_reauth ?? false,
    swid: data ? normalizeSwid(decryptSecret(data.swid_enc)) : null,
    linkedAt: data?.created_at ?? null,
  };
}

export async function markEspnNeedsReauth(userId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("espn_credentials")
    .update({ needs_reauth: true })
    .eq("user_id", userId);
}

export async function disconnectEspn(userId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("espn_credentials").delete().eq("user_id", userId);
}
