# Fantasy Football Manager

Yahoo fantasy football league companion — market-grounded player values, trade
analysis, waiver recommendations. See [PLAN.md](PLAN.md) for the full design.

**Status: Phase 2 (data + identity) complete.** On top of Phases 0–1 (Supabase
auth + RLS, Yahoo OAuth2 with encrypted tokens, league + team import): Sleeper,
FantasyCalc and DynastyProcess adapters, the player-identity crosswalk, and the
admin screen that resolves whatever the crosswalk cannot.

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

3. **Apply the schema.** Either paste each file in `supabase/migrations/` into
   the Supabase SQL editor in filename order, or use the CLI:

   ```bash
   npx supabase link --project-ref <project-ref> && npx supabase db push
   ```

4. **Set the auth redirect URLs** in Supabase → Authentication → URL
   Configuration: site URL `http://localhost:3000`, redirect
   `http://localhost:3000/auth/callback` (plus the deployed equivalents).

5. **Register a Yahoo app** at <https://developer.yahoo.com/apps/create/>:

   - API Permissions: **Fantasy Sports → Read**
   - Redirect URI: `https://<your-domain>/api/yahoo/callback`

   Yahoo rejects `http://localhost` callbacks. For local development, run a
   tunnel (`ngrok http 3000`, `cloudflared tunnel --url http://localhost:3000`),
   register the tunnel's HTTPS URL, and point `YAHOO_REDIRECT_URI` at it.

6. **Generate the token encryption key.**

   ```bash
   openssl rand -base64 32
   ```

7. **Run it.**

   ```bash
   npm run dev
   ```

Email confirmation is on by default in Supabase; sign-up then reports "check
your email". Turn it off under Authentication → Sign In / Providers for a
faster local loop.

## Layout

```
app/
  (auth)/            login + signup, auth server actions
  (app)/             signed-in shell — re-checks the user, not just middleware
    leagues/         Yahoo connection, league discovery, league + teams
  auth/callback/     code → session exchange (email links, future OAuth)
  api/yahoo/         OAuth authorize + callback
components/
  ui/                vendored shadcn components (ours to edit)
  leagues/           league and team UI
lib/supabase/
  client.ts          browser, anon key
  server.ts          RSC / route handlers / server actions, cookie session, RLS
  admin.ts           service role, `server-only`, bypasses RLS
  middleware.ts      session refresh + route gate
lib/sources/
  yahoo-auth.ts      OAuth exchange, refresh, encrypted token store
  yahoo.ts           transport — one adapter per external source
  yahoo-parse.ts     pure parsers (tested against fixtures)
  yahoo-json.ts      normalizer for Yahoo's XML-shaped JSON
  sleeper.ts         player master, stats, projections, season clock
  fantasycalc.ts     redraft trade values (Tier A of the value engine)
  dynastyprocess.ts  db_playerids.csv — the yahoo_id ↔ sleeper_id bridge
  csv.ts             minimal RFC-4180 parser, for that one file
  name-normalize.ts  the name key both sides of the crosswalk join on
lib/crosswalk/
  similarity.ts      pg_trgm-compatible trigram scoring
  resolve.ts         the resolution ladder, pure and unit-tested
  store.ts           seeding, persistence, the league resolution run
lib/players/master.ts  Sleeper player master → Postgres, 24h TTL
lib/leagues/import.ts  Yahoo league → Postgres
components/
  players/           identity resolution UI
supabase/migrations/
```

## How the Yahoo link works

1. `/api/yahoo/authorize` sets a random `state` in an httpOnly cookie and
   redirects to Yahoo.
2. Yahoo redirects back to `/api/yahoo/callback`, which checks `state` against
   the cookie before exchanging the code for tokens.
3. Tokens are encrypted with AES-256-GCM and written to `yahoo_tokens` by the
   service role. That table has RLS on and **no policy** — the anon key cannot
   reach it, and the browser never sees a Yahoo token.
4. Access tokens last an hour. Every call refreshes ahead of expiry, retries
   once on a 401, and marks `needs_reauth` when Yahoo rejects the refresh
   token — the UI then prompts for a re-link instead of failing silently.

Yahoo's `format=json` is XML with the tags relabelled: counted collections
(`{"0": …, "count": n}`) and fragment arrays. `lib/sources/yahoo-json.ts`
normalizes both, and `yahoo-parse.ts` shapes the result into domain types with
Zod. Those parsers are pure and covered by fixture tests — `npm test`.

Scoring is read from the league, never hardcoded: PPR comes from the receptions
stat modifier, `num_qbs` from the starting roster slots (superflex counts as
two), both feeding the FantasyCalc query params in Phase 3.

## How player identity works

Yahoo and the value sources share no player id, and no public source has Yahoo
ids for current rookies — so identity is resolved through a ladder, first hit
wins, and every result is persisted in `player_crosswalk` so the work happens
once per player rather than once per sync:

| # | Rung | Where |
|---|---|---|
| 1 | Manual override | `player_id_overrides`, written by the identity screen |
| 2 | DynastyProcess `db_playerids.csv` | seeded into the crosswalk on each master refresh |
| 3 | Sleeper's own `yahoo_id` | same seeding pass, lower precedence |
| 4 | Team defense by NFL team abbreviation | Yahoo models a defense as a team, not a player |
| 5 | Normalized name + position + team | `lib/crosswalk/resolve.ts` |
| 6 | Normalized name + position | catches in-season trades |
| 7 | Position-gated trigram fuzzy ≥ 0.88 | last resort, birth-date tiebreak |
| 8 | `unmatched_players` | surfaced on `/leagues/[id]/identity` |

Measured against the live sources: DynastyProcess resolves **149 of
FantasyCalc's 191** redraft players to a Yahoo id (78%); Sleeper's `yahoo_id`
adds nothing on top of that, and the 42 it misses are all 2025–26 rookies, who
have no Yahoo id in any public dataset and resolve by name alone. Run over the
same 191 players, the name rungs match **191/191** correctly — verified against
FantasyCalc's authoritative `sleeperId`.

Two rules the code will not bend:

- **An ambiguous match is not a match.** Two candidates that fit equally well
  and cannot be separated by team or birth date go to `unmatched_players`. The
  master holds 25 colliding name+position keys, so this is not hypothetical.
- **An unresolved player is never valued at zero.** It is written down, shown
  on the identity screen with ranked suggestions, and resolved in one click.

The 0.88 fuzzy threshold is deliberately strict — on space-stripped names it
only clears for near-identical spellings, which is the intended tradeoff: a
wrong match silently corrupts every trade verdict that touches the player,
while a miss costs one click. Suffix mismatches (`kennethwalkeriii` vs
`kennethwalker`) never reach that rung: candidates are indexed under both
Sleeper's `search_full_name` and our own normalization of their full name.

## Conventions

- **`getUser()`, never `getSession()`** on the server. It revalidates the token
  with Supabase instead of trusting a cookie.
- **Middleware is a redirect, not an authorization boundary.** Protected
  layouts re-check the user server-side.
- **Secrets stay server-side.** The browser gets the anon key and nothing else —
  no service-role key, and (Phase 1) no Yahoo token, ever.
- **Colors come from tokens**, not from component files. Position, provenance,
  and trade-verdict colors are all declared in `app/globals.css`.
- **One adapter per external source** under `lib/sources/`, with the pure
  parsing split out so it can be tested against recorded fixtures.
- **Global reference data is service-role only.** `players`, `player_crosswalk`,
  stats and projections are readable by any signed-in user and written only by
  the admin client; league data stays user-scoped and RLS-bound.

## Scripts

```bash
npm run dev     # dev server (turbopack)
npm run build   # production build
npm run lint    # eslint
npm test        # vitest
```
