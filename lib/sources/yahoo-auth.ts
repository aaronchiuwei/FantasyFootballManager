import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getSiteUrl } from "@/lib/site-url";

const AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

/** Refresh this far ahead of expiry so an in-flight sync never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Thrown when Yahoo will not mint a new access token — refresh token revoked,
 * app unlinked, or never connected. The UI turns this into a re-link prompt
 * rather than a failed sync (§12).
 */
export class YahooReauthRequired extends Error {
  constructor(message = "Yahoo account needs to be re-linked") {
    super(message);
    this.name = "YahooReauthRequired";
  }
}

export function yahooRedirectUri() {
  return process.env.YAHOO_REDIRECT_URI ?? `${getSiteUrl()}/api/yahoo/callback`;
}

function yahooCredentials() {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET must be set. Register an app at https://developer.yahoo.com/apps/create/",
    );
  }

  return { clientId, clientSecret };
}

export function buildAuthorizeUrl(state: string) {
  const { clientId } = yahooCredentials();
  const url = new URL(AUTHORIZE_URL);

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", yahooRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  // Scope is fixed at app registration (`fspt-r`); Yahoo rejects some requests
  // that also pass it here, so it is deliberately omitted.

  return url.toString();
}

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.coerce.number(),
  token_type: z.string().optional(),
  xoauth_yahoo_guid: z.string().optional(),
});

type TokenResponse = z.infer<typeof TokenResponse>;

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = yahooCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    // `invalid_grant` means the code or refresh token is dead — not retryable.
    if (response.status === 400 || response.status === 401) {
      throw new YahooReauthRequired(
        `Yahoo rejected the token request (${response.status}): ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`Yahoo token request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return TokenResponse.parse(JSON.parse(text));
}

async function persistTokens(userId: string, tokens: TokenResponse) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("yahoo_tokens").upsert(
    {
      user_id: userId,
      access_token_enc: encryptSecret(tokens.access_token),
      refresh_token_enc: encryptSecret(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      yahoo_guid: tokens.xoauth_yahoo_guid ?? null,
      needs_reauth: false,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Failed to store Yahoo tokens: ${error.message}`);
  }
}

/** Completes the OAuth dance and stores the encrypted tokens. */
export async function exchangeCodeForTokens(userId: string, code: string) {
  const tokens = await requestToken({
    grant_type: "authorization_code",
    redirect_uri: yahooRedirectUri(),
    code,
  });

  await persistTokens(userId, tokens);
  return tokens;
}

async function markNeedsReauth(userId: string) {
  const supabase = createAdminClient();
  await supabase
    .from("yahoo_tokens")
    .update({ needs_reauth: true })
    .eq("user_id", userId);
}

export type YahooConnection = {
  connected: boolean;
  needsReauth: boolean;
  yahooGuid: string | null;
  linkedAt: string | null;
};

/** Connection state for the UI. Never returns token material. */
export async function getYahooConnection(userId: string): Promise<YahooConnection> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("yahoo_tokens")
    .select("yahoo_guid, needs_reauth, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    connected: Boolean(data),
    needsReauth: data?.needs_reauth ?? false,
    yahooGuid: data?.yahoo_guid ?? null,
    linkedAt: data?.created_at ?? null,
  };
}

export async function disconnectYahoo(userId: string) {
  const supabase = createAdminClient();
  await supabase.from("yahoo_tokens").delete().eq("user_id", userId);
}

/**
 * Returns a usable access token, refreshing if it is expired or about to be.
 *
 * Yahoo's refresh tokens are reusable rather than rotating, so two concurrent
 * refreshes are wasteful but harmless — the last write wins and both tokens
 * stay valid.
 */
export async function getAccessToken(
  userId: string,
  { forceRefresh = false } = {},
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("yahoo_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at, needs_reauth")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read Yahoo tokens: ${error.message}`);
  }
  if (!data) {
    throw new YahooReauthRequired("No Yahoo account is linked");
  }
  if (data.needs_reauth) {
    throw new YahooReauthRequired();
  }

  const stillFresh =
    new Date(data.expires_at).getTime() - EXPIRY_SKEW_MS > Date.now();

  if (stillFresh && !forceRefresh) {
    return decryptSecret(data.access_token_enc);
  }

  try {
    const refreshed = await requestToken({
      grant_type: "refresh_token",
      redirect_uri: yahooRedirectUri(),
      refresh_token: decryptSecret(data.refresh_token_enc),
    });

    await persistTokens(userId, refreshed);
    return refreshed.access_token;
  } catch (cause) {
    if (cause instanceof YahooReauthRequired) {
      await markNeedsReauth(userId);
    }
    throw cause;
  }
}
