# Fantasy Football Manager

Yahoo fantasy football league companion — market-grounded player values, trade
analysis, waiver recommendations. See [PLAN.md](PLAN.md) for the full design.

**Status: Phase 4 (one-button sync) complete.** On top of Phases 0–3 (Supabase
auth + RLS, Yahoo OAuth2 with encrypted tokens, league + team import, the
Sleeper/FantasyCalc/DynastyProcess adapters, the player-identity crosswalk and
the value engine): everything above now refreshes from a single button, as an
eight-stage pipeline with a durable progress record and a live checklist.

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
    leagues/[id]/    league + teams, identity resolution, the values board
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
lib/values/
  vor.ts             replacement level, VOR, rest-of-season points
  isotonic.ts        PAVA regression + Spearman, both pure
  engine.ts          Tier A/B, guardrails, provenance — the value engine
  store.ts           sync stage 8 — the valuation, persisted to player_values
lib/sync/
  plan.ts            the eight stages and the run's shape — pure, shared with the browser
  clock.ts           season-clock arithmetic, pure
  run.ts             sync_runs lifecycle: open, advance, fail, resume
  stages.ts          what each of the eight stages actually does
  market.ts          sync stage 3 — the FantasyCalc board, persisted
  pipeline.ts        stage execution, HMAC-signed chaining
  use-sync-run.ts    the browser's Realtime subscription
lib/players/master.ts  Sleeper player master → Postgres, 24h TTL
lib/players/stats.ts   season projections + actuals → Postgres, and back out
lib/leagues/import.ts  Yahoo league, teams and matchups → Postgres
app/api/sync/          POST to start or resume; POST /[stage] to run one stage
components/
  players/           identity resolution UI
  values/            value badges, the values board
  sync/              the sync button, progress ring and staged checklist
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
two), and both are what the value engine sends to FantasyCalc.

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

## How player values work

Requirement 3 asks for a number on every player. FantasyCalc has 191 of them,
priced off real completed redraft trades; the other ~450 relevant players are
modelled and calibrated onto the same scale. Every row says which it is.

| Tier | Source | Covers | `value_source` |
|---|---|---|---|
| A | FantasyCalc redraft value | the 191 it prices | `market` |
| B | VOR, isotonically calibrated to FantasyCalc | the skill-player tail | `model` |
| B | same, held under a hard ceiling | K and DEF | `model_capped` |
| — | nominal, no market price and no projection | anyone else | `floor` |

Tier B is value over replacement — `projected_points − baseline(position)`,
where the baseline is the player at `teams × (starters + flex_share)`, read
from the league's own roster slots. VOR is in fantasy points, so it is bridged
onto market units by fitting **isotonic regression** on the ~190 players that
have both. Isotonic rather than linear because FantasyCalc's curve is steeply
convex — its top 100 hold 92.3% of all league value — and because monotonicity
guarantees a better projection never earns a lower value.

Three guardrails, and a live run of the engine against the 2026 preseason board
(12-team, 1QB, full PPR — 191 market players, 633 valued in total):

- **Clamp at the seam.** A modelled player is capped at the lowest market value
  at their own position, so a waiver flyer can never leapfrog a priced starter.
  Those caps are small — QB 23, TE 6, RB 3, WR 3 against a #1 of 10,775 —
  because FantasyCalc's list bottoms out near zero. Most of the model tier
  therefore lands on the market's floor, which is the honest answer: below the
  seam, players really are worth about nothing in trade. The *ordering* still
  has to mean something, so ranks break ties on VOR.
- **Cap K/DEF.** §5 suggests the QB2/TE2 tier as the ceiling. On the real curve
  that is 136, and the raw fit rates the best kicker at **3,195** — capping at
  136 still ranked every kicker above all 365 modelled skill players. The
  ceiling used instead is the market's own floor: the cheapest player
  FantasyCalc will price at all. That is §13's seam check generalized to a
  position the market declines to cover, and it matches §3's sharper statement
  that in redraft their trade value "genuinely *is* near zero."
- **Preseason degradation.** Until games are played the model runs on
  projections alone; actual pace then blends in at `w = min(0.7, games/10)`,
  and the result is scaled by `weeks_remaining / 17` because a redraft asset is
  a claim on the rest of the season and nothing else.

Two decisions worth stating plainly:

- **Market values are never adjusted.** Not for injury, not for anything. §6
  wants `injury_status` in the engine, and it is — on the model tier, where
  nothing else prices it. FantasyCalc's numbers come from managers who already
  knew about the injury, so discounting them again charges the same news twice
  and costs the one property that makes a verdict arguable with a leaguemate:
  that the number is quotable. Injury *status* rides along on every row instead.
- **Nothing is ever worth zero.** `player_values` has a `check (value > 0)` on
  it, because a zero is indistinguishable from a missing value by the time it
  reaches trade math.

**Where it falls short of §13.** The fit's rank correlation against FantasyCalc
on the overlap is **0.928**, under the 0.98 target. Within a position it is
much closer — QB 0.971, RB 0.974, WR 0.950, TE 0.865 — so the gap is mostly
cross-position: a single curve has to span a market that prices QBs far below
their VOR in a 1QB league. It matters less than the number suggests, because
the seam clamps pin the whole model tier to the market's floor regardless, and
§5's own arithmetic says every trade worth proposing is 100% market-valued.
Per-position fits are the obvious next move if that ever stops being true.

## How the sync works

One button, but not one request. Yahoo's pagination plus a 14.6 MB Sleeper
payload will not fit in a serverless invocation, so the sync is eight stages
that hand work to each other **through Postgres**, never through memory:

| # | Stage | Work | Skips when |
|---|---|---|---|
| 1 | `state` | Sleeper's season clock; the league parameters the rest are keyed on | — |
| 2 | `players` | Sleeper's player master, and the Yahoo half of the crosswalk | cached <24h |
| 3 | `values` | The FantasyCalc board for this league's scoring | — |
| 4 | `projections` | Season-total projections | — |
| 5 | `stats` | Season-to-date actuals | preseason |
| 6 | `yahoo` | Settings, standings, teams, rosters, matchups, free agents | — |
| 7 | `resolve` | The §4 identity ladder over what stage 6 pulled | — |
| 8 | `compute` | The §5 value engine over everything above | — |

`POST /api/sync` opens a `sync_runs` row and kicks stage 1;
`POST /api/sync/[stage]` runs one stage, records it, and hands the next one to
a fresh invocation. Those hops carry no cookie session, so they are authorized
by an **HMAC over the run id** — a leaked token is good for exactly one run.
The work happens in `after()`, so the calling stage's request returns
immediately rather than being held open for what it triggered.

**The handoff tables are the point.** `market_values` holds the board stage 3
fetched and `yahoo_player_pool` holds the players stage 6 pulled, so stages 7
and 8 are pure reads. That is what makes "retry from the failed stage" cheap
and honest: a resolve that broke re-runs without paying Yahoo's free-agent
pagination again, and a valuation that broke re-runs without touching any
external API at all.

**Failure is a state, not an exception.** A stage that throws is recorded as
failed on the run and the chain stops; everything before it stays committed.
A stage that is *killed* — OOM, timeout — cannot record anything, so the run
simply goes quiet, and both the UI (after 90s) and the next sync (after 5min)
treat a silent `running` row as stalled and offer to resume it. Resuming
reopens the same row from the first unfinished stage rather than starting a
second run; a partial unique index on `sync_runs (league_id) where status =
'running'` makes "two syncs of one league" unrepresentable.

**Progress is live.** The browser subscribes to its own `sync_runs` row over
Supabase Realtime — the owner policy is applied to the socket's own JWT, so a
user streams only their own runs — and renders the checklist from it. A slow
poll runs alongside while a sync is in flight, because a progress UI that shows
nothing at all when a publication was not applied is a worse failure than a few
extra requests.

**Where the invariants live.** §13's checks — the seam clamp, the rank
correlation against FantasyCalc, the 95% auto-resolution bar — are evaluated on
every run and written to the stage that raised them. They are a property of the
data, not of the test suite, so the durable progress record is where they
belong.

Two things this deliberately does not do. It does not re-read Yahoo's settings
before stage 3, so a league whose scoring changes mid-season prices on the
previous settings for exactly one sync — the alternative is asking Yahoo for
settings twice per run, and the lag is one refresh. And it does not run under
the user's RLS-bound client: there is no cookie session in a machine-to-machine
hop, so the pipeline uses the service role, scoped by the `league_id` on a run
row that an authenticated owner created. That row is the authorization record.

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
- **Data-access modules take a client, they do not make one.** Which client is
  right depends on the caller — the user's RLS-bound one interactively, the
  service role inside the sync pipeline — so `Db` is a parameter (`lib/supabase/db.ts`).
- **Sync stages hand off through Postgres, never through memory.** Each stage
  is its own invocation; anything the next one needs has to be committed first.

## Scripts

```bash
npm run dev     # dev server (turbopack)
npm run build   # production build
npm run lint    # eslint
npm test        # vitest
```
