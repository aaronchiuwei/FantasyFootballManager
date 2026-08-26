import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./database.types";

/**
 * Routes a signed-out visitor may reach. Everything else redirects to /login.
 *
 * `/trade` is the open analyzer: it prices two packages against the market
 * board and reads nothing that belongs to anybody, so requiring an account to
 * see it would gate the one answer the product exists to give behind the one
 * step most visitors will not take.
 */
const PUBLIC_PATHS = ["/", "/trade", "/login", "/signup", "/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Refreshes the auth session on every request and gates protected routes.
 *
 * The response object must be returned as-is: `supabase.auth.getUser()` may
 * rotate the session cookies, and those writes live on this response.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(): it revalidates the token with Supabase Auth
  // instead of trusting a cookie the client could have forged.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    // Keep the query string: an OAuth callback is worthless without its code.
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return response;
}
