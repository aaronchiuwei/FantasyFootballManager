# Fantasy Football Manager

Yahoo fantasy football league companion — market-grounded player values, trade
analysis, waiver recommendations. See [PLAN.md](PLAN.md) for the full design.

**Status: Phase 0 (Foundation) complete.** Next.js 15 + Tailwind v4 + shadcn/ui,
Supabase auth with session refresh in middleware, an RLS baseline, and the
design tokens the later phases spend.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 App Router, React 19, TypeScript |
| Styling | Tailwind v4 + shadcn/ui (`radix-nova`), tokens in `app/globals.css` |
| Auth + data | Supabase (Postgres, Auth, RLS) via `@supabase/ssr` |

## Setup

1. **Create a Supabase project** at <https://supabase.com/dashboard>.

2. **Configure env.** Copy the template and fill in Project Settings → API:

   ```bash
   cp .env.example .env.local
   ```

3. **Apply the schema.** Either paste
   `supabase/migrations/20260825000000_auth_baseline.sql` into the Supabase SQL
   editor, or use the CLI:

   ```bash
   npx supabase link --project-ref <project-ref> && npx supabase db push
   ```

4. **Set the auth redirect URLs** in Supabase → Authentication → URL
   Configuration: site URL `http://localhost:3000`, redirect
   `http://localhost:3000/auth/callback` (plus the deployed equivalents).

5. **Run it.**

   ```bash
   npm run dev
   ```

Email confirmation is on by default in Supabase; sign-up then reports "check
your email". Turn it off under Authentication → Sign In / Providers for a
faster local loop.

## Layout

```
app/
  (auth)/          login + signup, auth server actions
  (app)/           signed-in shell — re-checks the user, not just middleware
  auth/callback/   code → session exchange (email links, future OAuth)
components/
  ui/              vendored shadcn components (ours to edit)
lib/supabase/
  client.ts        browser, anon key
  server.ts        RSC / route handlers / server actions, cookie session, RLS
  admin.ts         service role, `server-only`, bypasses RLS
  middleware.ts    session refresh + route gate
supabase/migrations/
```

## Conventions

- **`getUser()`, never `getSession()`** on the server. It revalidates the token
  with Supabase instead of trusting a cookie.
- **Middleware is a redirect, not an authorization boundary.** Protected
  layouts re-check the user server-side.
- **Secrets stay server-side.** The browser gets the anon key and nothing else —
  no service-role key, and (Phase 1) no Yahoo token, ever.
- **Colors come from tokens**, not from component files. Position, provenance,
  and trade-verdict colors are all declared in `app/globals.css`.

## Scripts

```bash
npm run dev     # dev server (turbopack)
npm run build   # production build
npm run lint    # eslint
```
