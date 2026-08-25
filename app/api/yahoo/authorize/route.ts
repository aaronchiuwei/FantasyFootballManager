import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { buildAuthorizeUrl } from "@/lib/sources/yahoo-auth";
import { createClient } from "@/lib/supabase/server";

export const OAUTH_STATE_COOKIE = "yahoo_oauth_state";

/** Starts the Yahoo OAuth2 flow. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/login?next=%2Fleagues", request.nextUrl.origin),
    );
  }

  // CSRF guard: Yahoo echoes `state` back, and we only trust a value that
  // matches the httpOnly cookie we set here.
  const state = randomBytes(16).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
