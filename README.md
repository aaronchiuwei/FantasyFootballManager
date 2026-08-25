# Fantasy Football Manager

Yahoo fantasy football league companion — market-grounded player values, trade
analysis, waiver recommendations. See [PLAN.md](PLAN.md) for the full design.

**Status: Phase 6 (trade analyzer) complete.** On top of Phases 0–5 (Supabase
auth + RLS, Yahoo OAuth2 with encrypted tokens, league + team import, the
Sleeper/FantasyCalc/DynastyProcess adapters, the player-identity crosswalk, the
value engine, the one-button sync and the stats surface): any two rosters in
the league can now be put on a balance beam. Both packages are summed at their
market value, adjusted for who holds the best player and how many roster spots
the deal fills, and answered with one of four fairness bands — or with a refusal
to answer, when a player in the deal has no resolved value.

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
      players/[playerId]/  one player: value, stats, week-by-week
      trade/           the trade analyzer, and the trades kept from it
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
lib/trades/
  analyze.ts         §6's bonus math and fairness bands — pure, runs in the browser
  saved.ts           the frozen payload a saved trade stores, parsed with Zod
  store.ts           league_settings and saved_trades, plus the analyzer's one read
lib/players/
  master.ts          Sleeper player master → Postgres, 24h TTL
  stats.ts           sync stages 4 and 5 — season totals and the weekly grid
  stat-lines.ts      actuals against projections, pure and unit-tested
  detail.ts          the player page's four reads
lib/leagues/import.ts  Yahoo league, teams and matchups → Postgres
app/api/sync/          POST to start or resume; POST /[stage] to run one stage
components/
  players/           identity resolution UI, the stat surface
  values/            value badges, the values board
  trade/             the balance beam, the drop zones, the verdict
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

## How the stats surface works

Requirement 4 asks for current *and* projected stats on every player. The
awkward part is the word "current": `/v1/state/nfl` reports **2026, `pre`,
week 3**, and `/stats/nfl/regular/2026/1` answers `{}`. There are no
current-season stats, and there will not be until Week 1.

Rendering an empty table and calling the requirement met would be the dishonest
answer. §12's mitigation is the one taken instead — **fall back to the prior
season's actuals as context and label the UI accordingly** — so every player
page shows two seasons side by side:

| | 2026 | 2025 |
|---|---|---|
| Projected | season total + a line for every week the league plays | — |
| Actual | nothing yet, and it says so | the full 18-week game log |

Both come from Sleeper, into the `player_stats` / `player_projections` tables
§8 already keyed `(player_id, season, week)` with `week = 0` reserved for the
season total. Until this phase nothing had ever been written at a week other
than 0.

**The weekly endpoint is not the one §3 wrote down.** The plan has
`/projections/nfl/{season}/{week}`, and that path does answer 200 — with 7,627
entries, not one of which carries a single scoring key. The season-type segment
is required on the weekly form exactly as it is on the season one. Measured on
2026 week 1: `/projections/nfl/2026/1` returns 943 empty objects,
`/projections/nfl/regular/2026/1` returns those same 943 players with `pts_ppr`
on every one. Across the 2026 slate that is 780–954 scored projections a week;
2025's actuals run 326–514 a week. Eighteen weeks, fetched four at a time,
takes about three seconds — comfortably inside §9's ~60s stage budget.

A weekly payload lists *every* player in the league, so most of what comes back
is an empty object or a lone ADP field — a bye, a healthy scratch and a player
Sleeper simply has nothing for are indistinguishable. Those lines are dropped
before they are written, because eighteen weeks of them is tens of thousands of
rows that say nothing, and because **a missing week is exactly how the page
renders "no game."**

**What has been pulled is itself a table.** `stat_coverage` records every
`(season, week, kind)` that landed. It does two jobs:

- **Skipping frozen work.** A finished season's game log cannot change, and
  neither can a projection for a week already played. Both are pulled once and
  then left alone, which is what keeps a stage with eighteen weeks in its
  window from paying for all of them on every sync. The cost, stated rather
  than hidden: a stat correction applied to an already-pulled week is not
  chased.
- **Telling "not fetched" apart from "did not play."** Those are different
  claims and must not render the same way. The page's freshness line comes from
  here.

Two smaller decisions that follow the rules the rest of the app already runs on:

- **Scoring is applied on read, never trusted from the stored `pts_ppr`.** One
  stat row is shared by every league in the app, and §1.2's rule is that the
  league's own PPR modifier decides what it is worth. The same rule the value
  engine follows on season totals, applied to every week.
- **The season total is Sleeper's own `week: 0` row, not a sum of the grid.**
  The grid deliberately drops the lines with no scoring in them, so summing
  what survived is a different — and smaller — number. Summing is the fallback
  for a season whose totals were never pulled.

The merge itself is a pure function (`lib/players/stat-lines.ts`), unit-tested,
rather than a database view. `league_player_values` earned a view because it
joins four tables and pages two hundred rows; this is one player, and the join
depends on a league's PPR modifier that a view keyed only on the player cannot
see.

**Where it falls short.** There is no opponent column — nothing in the app maps
a player to an NFL schedule yet, and §6's bye-week and playoff-schedule work is
Phase 6's. The prior season is pulled over the NFL's weeks 1–18 rather than the
league's own window, because the league's *previous* season's start and end
weeks are not something Yahoo tells us about the current one. And the box score
is the handful of columns a box score actually uses; the other forty keys
Sleeper ships per game are stored in the `stats` jsonb, where a later phase can
reach them.

## How the trade analyzer works

Requirement 5 asks whether a trade is fair; Requirement 6 asks who is getting
the best player. Both are arithmetic over the values Phase 3 already computed,
which is why §11 calls this phase mechanical — the hard part was earning the
right to sum those numbers.

### The two sides

```
side_base     = Σ value(p)
bonus         = α × value(best on this side)              α  0.08
headline      = γ × (best in the deal − best on the other side)   γ  0.05
depth_penalty = β × (n − 1) × median(side)                β  0.03
side_total    = side_base + bonus + headline − depth_penalty

Δ    = A_total − B_total
pct  = |Δ| / max(A_total, B_total)
```

| `pct` | Verdict | Beam |
|---|---|---|
| < 3% | Even | level, `--verdict-fair` |
| < 8% | Slight edge | `--verdict-fair` |
| < 15% | Clear winner | `--verdict-tilted` |
| ≥ 15% | Lopsided | `--verdict-lopsided` |

Four bands, three color tokens, so one boundary carries the color change. It is
the 8% one, because that is where the rest of the app already draws the line:
§9's win-win search keeps `pct < 8%` and calls what survives *fair by value*. A
slight edge is a fair trade that happens to have a direction.

### The three knobs, and why α is not 0.15

**α is 0.08.** §8's schema sketch says 0.15; §6 then measured the two candidate
value curves against each other and concluded otherwise, and this is the number
it landed on. FantasyCalc's curve is steeply top-heavy — its top 100 hold 92.3%
of all league value, against KeepTradeCut's 53% — which means **the superstar
premium is already inside the numbers being summed**. Charging 0.15 on top of
that bills the same premium twice, and the analyzer starts approving every
2-for-1. §6 calls this the single most important tuning decision in the app.

**γ is charged on the margin, not the whole player.** §6 writes it as `γ ×
value(top)` for the best player in the deal. Taken literally that quantity is
zero when the two headliners are exactly equal and 5% of a first-rounder the
moment one of them is a single point better — a discontinuity that gives two
indistinguishable trades different verdicts. Charging it on the *gap* between
the headliners keeps the property §6 argues for one paragraph earlier ("when
both packages are headlined by comparable studs the effect largely cancels —
which is correct"), still pays the side holding the genuine top asset, and is
continuous everywhere. `analyze.test.ts` pins that continuity.

**β is the counterweight**, and it earns its place exactly as §6 says: without
it the calculator approves 4-for-1 packages no real manager would accept,
because roster spots are finite. On this curve it is a small correction — the
convex value curve does most of that work already — which is why the sliders
exist. All three are per-league, stored in `league_settings`, and moving one
re-prices the open trade in the same tick.

The calibration mechanism is §13's: a golden-file table of hand-checked trades
in `lib/trades/analyze.test.ts`, including the adversarial ones. Two of them are
the whole requirement in miniature:

| Trade | Verdict |
|---|---|
| 9,000 for four players summing to 9,000 | **Clear winner** — the side with the best player |
| 9,000 for four players summing to 9,800 | **Even** — consolidating costs about a 9% premium |

That premium *is* Requirement 6. If a knob's default ever moves, the
expectation that changes in that table is the argument for or against moving it.

### Refusing to answer

`TradeAnalysis.verdict` is nullable, and that is not defensiveness — it is §4's
non-negotiable rule made unrepresentable rather than merely documented. Two
situations produce no verdict object at all:

- **A player with no resolved value.** A `floor` value means the market has no
  price and there is no projection to model from. Summing it as though it were a
  real number is the worst failure this app has, because it is invisible; the
  analyzer names the player and links to the identity screen instead. Rostered
  players who never resolved are not on the board at all, and the page says how
  many.
- **An empty side.** A half-built trade is incomplete, not lopsided. Declaring
  "LOPSIDED" at someone who has added one player and is reaching for the second
  is a calculator arguing with its own loading state.

Kickers and defenses are the case that looks similar and is not. They are
flagged in the deal ("not a trade asset", §3) but they do not block anything,
because the value engine already priced them at the market's own floor — adding
two of them to a package moves the totals by less than a percent, which is the
honest answer rather than a special case in the trade math.

### Provenance survives into the verdict

§5 says a trade built on model values is a fuzzier trade. That sentence is
turned into arithmetic here rather than stopping at the badge: every value
carries a plausible error as a share of itself, and the analyzer reports the
margin those errors could account for on their own.

| Provenance | Error |
|---|---|
| `market` | 0 |
| `model` | 35% |
| `model_capped` | 50% |
| `floor` | — refuses a verdict |

Market is zero on purpose. Not because FantasyCalc is perfect, but because on
this app's terms the market *is* the scale (§5: market values are never
adjusted, and the whole worth of the number is that it is quotable). So an
all-market trade — which §5's coverage arithmetic says is every trade you would
realistically propose — gets a firm verdict with no hedging, and the panel says
so. A deal down in the modelled tail gets its band *and* a line admitting the
gap is inside the error bars. The errors are added linearly rather than in
quadrature because they are not independent: they come off one isotonic fit.

### Where it runs

§2 requires the analyzer to be "pure and fast enough to run on every keystroke
against cached values", so it is: `lib/trades/analyze.ts` imports no transport,
takes no client, and is generic over the asset so the page's own rows come back
out of it with their names attached. The page hands the browser the league's
entire rostered board — about 180 players — in one read, and every add, drag and
slider nudge re-prices the deal locally. The server is asked for exactly two
things: persist the knobs, and persist a saved trade.

Saving is the one place the client's arithmetic is not trusted. The browser
posts player ids and knob positions, never totals; the action re-reads the
board, re-runs the same pure function, and stores *its* result. They agree
because it is literally the same function.

### Saved trades keep their own values

`saved_trades.payload` freezes both sides, every player's value and provenance,
the knobs in force and the resulting margin. Denormalized on purpose: values
move on every sync, and a saved verdict that silently re-derives is not a record
of anything. Loading one back into the analyzer re-prices it against today's
board — which is the interesting comparison, and it needs yesterday's numbers to
still be there to compare against. Players who have since changed teams are
dropped from the reload, with a toast rather than a silent substitution.

### The beam

§10 calls this screen the centerpiece and names the interaction: two drop zones,
a beam tipping by `pct`, values counting up, a verdict crossfade. The tilt is
computed from the analysis rather than eyeballed, saturating at 30% — twice the
lopsided threshold, so a trade that has only just crossed the line still has
room to get worse. The heavier side goes *down*, the way a scale does, and the
pans are solved to hang level rather than rotated with the arm. Dragging is the
pleasant path; clicking is the one that works with a keyboard, a screen reader
and a phone, so both do the same thing. Every animation is a CSS transform
transition or a `requestAnimationFrame` that checks `prefers-reduced-motion`
first — under reduced motion the beam is a still, equally readable diagram.

### Where it falls short

**There is no roster-context delta yet.** §6 asks for each team's starting
lineup projected points before and after, alongside the value verdict — "what
makes a trade *good for you* as opposed to merely *even*". It needs starters,
positional strength and league means, which is precisely §7's needs vector and
therefore Phase 7's. The value verdict is the primary one either way (§1.5), and
the seam is clean: the analyzer is a pure function over assets, and a second
scorer over the same two packages does not disturb it.

**No bye weeks and no playoff schedule.** §6 wants both as redraft-specific
signals. Nothing in the app maps a player to an NFL schedule — the bye-week data
§6 cites ships from KeepTradeCut, which §3 dropped as a source for good reasons.
That is a data acquisition problem, not a trade-math one.

**The trade deadline is not enforced.** §6 wants it surfaced and the suggestion
engines disabled past it. Yahoo reports it in league settings; nothing reads it
yet, and there are no suggestion engines to disable until Phase 8.

## How the sync works

One button, but not one request. Yahoo's pagination plus a 14.6 MB Sleeper
payload will not fit in a serverless invocation, so the sync is eight stages
that hand work to each other **through Postgres**, never through memory:

| # | Stage | Work | Skips when |
|---|---|---|---|
| 1 | `state` | Sleeper's season clock; the league parameters the rest are keyed on | — |
| 2 | `players` | Sleeper's player master, and the Yahoo half of the crosswalk | cached <24h |
| 3 | `values` | The FantasyCalc board for this league's scoring | — |
| 4 | `projections` | Season totals, plus a projection for every week the league plays | — |
| 5 | `stats` | Season-to-date actuals, plus last season's game log as context | already stored |
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
  stats, projections and `stat_coverage` are readable by any signed-in user and
  written only by the admin client; league data stays user-scoped and RLS-bound.
- **Data-access modules take a client, they do not make one.** Which client is
  right depends on the caller — the user's RLS-bound one interactively, the
  service role inside the sync pipeline — so `Db` is a parameter (`lib/supabase/db.ts`).
- **Sync stages hand off through Postgres, never through memory.** Each stage
  is its own invocation; anything the next one needs has to be committed first.
- **Math the browser reruns lives in a pure module.** `lib/sync/plan.ts` and
  `lib/trades/analyze.ts` carry no transport and no `server-only`, so both sides
  run the same function over the same data. The corollary is a bundle rule:
  client components import *types* from the modules next door to those, never
  values, or a Zod parser the browser never runs ships to it anyway.

## Scripts

```bash
npm run dev     # dev server (turbopack)
npm run build   # production build
npm run lint    # eslint
npm test        # vitest
```
