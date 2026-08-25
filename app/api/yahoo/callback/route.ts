import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { exchangeCodeForTokens } from "@/lib/sources/yahoo-auth";
import { createClient } from "@/lib/supabase/server";
import { OAUTH_STATE_COOKIE } from "../authorize/route";

function back(origin: string, params: Record<string, string>) {
  const url = new URL("/leagues", origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/** Yahoo redirects here with `?code=&state=`. Exchanges the code for tokens. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=%2Fleagues", origin));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  const denial = searchParams.get("error");
  if (denial) {
    return back(origin, {
      error:
        searchParams.get("error_description") ??
        `Yahoo declined the request (${denial}).`,
    });
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return back(origin, { error: "Yahoo did not return an authorization code." });
  }
  if (!expectedState || state !== expectedState) {
    return back(origin, {
      error: "That link expired or did not come from us. Try connecting again.",
    });
  }

  try {
    await exchangeCodeForTokens(user.id, code);
  } catch (cause) {
    return back(origin, {
      error: cause instanceof Error ? cause.message : "Failed to link Yahoo.",
    });
  }

  return back(origin, { connected: "1" });
}
