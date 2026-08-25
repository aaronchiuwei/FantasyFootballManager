# Fantasy Football Manager

Yahoo fantasy football league companion — market-grounded player values, trade
analysis, waiver recommendations. See [PLAN.md](PLAN.md) for the full design.

**Status: Phase 9 (three-team trades) complete.** On top of Phases 0–8
(Supabase auth + RLS, Yahoo OAuth2 with encrypted tokens, league + team import,
the Sleeper/FantasyCalc/DynastyProcess adapters, the player-identity crosswalk,
the value engine, the one-button sync, the stats surface, the trade analyzer,
the needs vector and the two suggestion engines): the search now closes rings as
well as pairs. A three-team trade is a cycle — you give to one manager, they
give to a second, the second gives back to you — and it is the deal to make when
the manager holding what you want does not want what you have. It is found by a
**bounded beam search**, which is not exhaustive and says so, and every one of
the three managers is priced on their own ledger by Phase 6's verdict function,
because a ring that balances overall can still be robbing one of the three.

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
      overview/        the twelve teams as positional strength radars
      waivers/         the available pool, ranked and need-weighted
      suggestions/     the win-win board, the build-around-a-player panel, and
                       the three-team cycles this team could be in
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
lib/needs/
  needs.ts           §7's needs vector — pure, and what Phases 8–9 stand on
  lineup.ts          the best startable lineup, and what a trade does to it — pure
  store.ts           sync stage 8 — team_needs, persisted; the overview's read
lib/suggestions/
  search.ts          §9's win-win search and §10's builder — pure, bounded, tested
  cycles.ts          Req. 11's three-team cycle beam search — pure, bounded, tested
  payload.ts         the frozen package a cached suggestion stores, parsed with Zod
  store.ts           sync stage 8 — trade_suggestions and cycle_suggestions; the builder
lib/waivers/
  score.ts           §7's `ros × (1 + λ × need)` — pure, runs in the browser
  store.ts           Yahoo's available pool, the needs it is weighted by, and λ
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
  trade/             the balance beam, the drop zones, the verdict, the lineup delta
  needs/             the positional radar, need and depth chips, the team card
  waivers/           the ranked wire, and the λ slider that tilts it
  suggestions/       the package card, the stack that cycles them, the builder,
                     and the three-team ring card and its per-team board
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

### The roster-context delta

§6 also asks for each team's starting lineup projected points before and after
the trade — "what makes a trade *good for you* as opposed to merely *even*".
Phase 6 left the seam and Phase 7 filled it: `lib/needs/lineup.ts` is a second
scorer over the same two packages, pure and local, so it re-runs on the same
keystroke the verdict does. It is described under
[needs and waivers](#how-needs-and-waivers-work) with the rest of §7's math.

It stays **secondary**, and that is §1.5's rule rather than a shortcut: trade
evaluation is value-first, context-second, so nothing in the lineup delta moves
the fairness band. The two numbers are in different currencies — market value
above, projected points below — because they answer different questions, and
collapsing them into one score would lose both answers.

### Where it falls short

**No bye weeks and no playoff schedule.** §6 wants both as redraft-specific
signals. Nothing in the app maps a player to an NFL schedule — the bye-week data
§6 cites ships from KeepTradeCut, which §3 dropped as a source for good reasons.
That is a data acquisition problem, not a trade-math one.

**The trade deadline is not enforced.** §6 wants it surfaced and the suggestion
engines disabled past it. Yahoo reports it in league settings; nothing reads it
yet. Phase 8 built the engines, so only the second half of that sentence is
still missing — it is recorded again under
[the suggestion engines](#how-the-suggestion-engines-work).

## How needs and waivers work

§7 opens with one structure and then spends four features out of it. Everything
on this page is that structure, or a fold over it:

```
starters(p)   = top k_p players by projection at position p
strength(p)   = Σ projections of starters(p)
z(p)          = (strength(p) − league_mean(p)) / league_sd(p)
need(p)       = −z(p)              positive ⇒ weakness
surplus(p)    = Σ projections of players above the starter requirement
```

It is computed once per sync, in stage 8, immediately after the valuation — and
`lib/needs/needs.ts` is a pure module with no transport and no `server-only`,
the way `vor.ts` and `analyze.ts` are, because Phases 8 and 9 will optimize
against these numbers and a bug in here is a bug in every suggestion they make.

### The four decisions inside those five lines

**`k_p` is fractional, and so is the player who fills it.** A standard W/R/T
league starts 2.5 running backs — the flex slot is genuinely half of one, split
across the positions that fill it by the same weights §5's replacement level
uses. So the third RB counts for half his projection toward strength and half
toward surplus. Rounding `k_p` would make him either free or worthless, and move
a team's strength by a whole player for a slot that half exists.

**The z-score is against this league and nobody else.** Twelve teams, population
standard deviation rather than sample: these *are* every team, not a draw from
somewhere larger. What makes a position a need is not that a roster is bad in
the abstract, it is that the eleven managers you play against are better there.

**A league with no spread gets zeroes, not infinities.** If every team's
quarterbacks project identically the standard deviation is zero and every team
is exactly average — which is true, and is what the code returns. The guard is
relative rather than absolute, because twelve identical sums computed in
different orders differ in the last bit and produce a spread of about 1e-13, not
0. Two positions reach that state honestly rather than by accident: one nobody
in the league starts (`k_p = 0` makes every strength 0), and one nobody rosters.

**Surplus gets its own z-score.** §8's schema sketch names six columns; the
table has a seventh, `surplus_z`, because raw surplus points are not comparable
across positions — a quarterback outscores a tight end for reasons that have
nothing to do with depth — and "this team's biggest surplus" has to survive that
comparison to mean anything. It is what §7's later phases weight toward when
they go looking for a trade.

### Provenance, for a number made of projections

§5's rule is that a value says where it came from. A needs row is not made of
values, it is made of projections — so the same honesty is owed in the
projection's own terms, and the row carries a `confidence`: the share of the
team's players at that position that could be seen at all.

A player with no projection is precisely §5's `floor` tier — no market price and
nothing to model from. They contribute nothing to a strength that is a sum, and
without the column that absence is *invisible*, which is the exact failure mode
§4 spends the entire crosswalk avoiding. So the overview card says so
underneath the shape, stage 8 raises a warning when more than a tenth of the
league's rostered players are unprojected, and the trade page's lineup delta
names the ones it could not see. The waiver board is the other half of the same
rule: every row carries its value badge, so a model-priced flyer is legible as
one — it just does not affect where the row sits.

### Rest of season, stored once

Both halves of this phase are denominated in rest-of-season points, and §5's
value engine was already computing that number for every player it priced —
the season projection, blended with actual pace at `min(0.7, games/10)` once
games are played, scaled by `weeks_remaining / 17`. It was an intermediate that
died inside the engine. It is now `player_values.ros_points`, which is the one
change here that reaches back into an earlier phase, and it is worth it: the
alternative is a second definition of "the rest of this season" in the same app,
drifting from the first.

### The league overview

§10 asks for a staggered card grid with a positional strength radar per team,
and the radar's axes are **z-scores, not points** — that is the whole reason the
shape says anything, since 300 quarterback points and 300 tight-end points are
not the same claim but "one standard deviation above this league" and "one
standard deviation above this league" are. The dashed ring is the league
average: a vertex inside it is a need, a vertex outside it is depth, and the two
chips underneath name the largest of each. Cards are ordered by projected
starters rather than by the standings, because the standings are one click away
on the league page and this screen is asking a different question.

It is plain SVG in a server component. §10's performance guardrail is to keep
heavy visual dependencies off the data-dense pages, and a hexagon with six
vertices does not need a charting library. The stagger is a CSS animation with a
per-card delay, so `motion-reduce:animate-none` cancels it outright: under
reduced motion twelve cards simply appear, which is the same information without
the wait.

The headline number on each card is Σ strength across the six positions. `k_p`
sums to the number of starting slots, so summing the top `k_p` at each position
spends every slot exactly once — it is the optimal lineup approached from the
other side, and it needs only the cached vector rather than twelve rosters.

### The waiver wire

```
score = ros_projected_points(p) × (1 + λ × need(position(p)))
```

**The ordering is the argument.** §7 is emphatic that the wire ranks on
projection and not on estimated trade value, and the reason is arithmetic:
free agents sit almost entirely below FantasyCalc's 191, so ranking them by
value would mean sorting on an estimate of a number that is near zero for every
one of them — noise amplified into a ranking. Values still appear on every row
with their badge, for continuity with the rest of the app. They do not order it.

Three things about the need term, none of them in the plan's one line:

- **λ is clamped to 1.5, not the schema's 5.** λ multiplies a z-score, which is
  unbounded. At 1 a team one standard deviation thin at a position doubles every
  free agent there — already an aggressive reading — and past about 1.5 the
  board stops ranking players and starts ranking positions. The check constraint
  stays loose so a later phase can want more without a migration.
- **The need is clamped to ±1 standard deviation.** Beyond that the direction is
  established and the magnitude is mostly the tail of a twelve-sample estimate.
  One catastrophic roster in the league should not triple a kicker.
- **The multiplier is floored at zero.** With the clamps above it can only bind
  at λ > 1, and it is a guard rather than a judgement: a negative multiplier
  would put the best free agent at a position you are deep in *below* the worst,
  which is not a stronger way of saying "you do not need one".

**"Available" means Yahoo says so.** `player_values` prices roughly six hundred
players, most of whom Yahoo has never offered in any league, so "not on a
roster" would be the wrong pool — a recommendation you cannot act on is not a
recommendation. Stage 6 already parks the top ~150 free agents Yahoo ranks in
`yahoo_player_pool`; the `league_free_agents` view joins that to identity by
running §4's ladder in SQL — the manual override wins, the persisted crosswalk
answers the rest — and drops anyone who has since been rostered. A Yahoo player
who resolved to nobody has no row at all; they are on the identity screen, which
is where an unmatched player belongs.

λ is the fourth of §8's per-league tunables and the only one Phase 6 left at its
default. It behaves exactly like α, β and γ: the slider re-ranks the board in
the browser on every nudge, and the server is asked once, on release.

### What a trade does to a lineup

The same needs machinery answers §6's roster-context delta. `bestLineup` solves
a roster against the league's own starting slots, `lineupChange` solves it twice
— before and after — and the panel sits under the balance beam.

The greedy fill is **optimal here rather than merely convenient**. Fantasy
eligibility sets are laminar: `{RB}` sits inside `{RB, WR, TE}` sits inside
`{QB, RB, WR, TE}`, and any two sets are nested or disjoint. On a laminar
family, filling the narrowest slot first with the best eligible player can never
strand a better assignment, because anyone that slot could have taken instead is
still eligible for every wider slot behind it. A general bipartite matching
would be the right tool for a league whose slots overlap partially, and no such
league exists.

Both lineups are re-solved rather than diffed, because a trade changes who
*else* starts: sending the third-best running back away is free until the flex
spot has nobody left to take, and a diff of two rosters would never notice.
Unprojected players are not candidates — inventing a zero for them would let a
lineup "improve" by shedding them — and the panel reports how many of those the
deal contains, along with any starting slot the trade would leave empty.

The panel renders as soon as both sides have a player, **including when the
value verdict is refused**. An unvalued player blocks a *price*; the lineup
question is asked in projected points, and that is a different number that may
well still exist.

### Where it falls short

**No shared-element transition.** §10 pairs the overview grid with one into a
team detail page. There is no team detail page — a team card links to the values
board filtered to that roster, which is where Phase 2 put it — so there is
nothing to transition into yet.

**Strength ignores who is actually startable this week.** A player on IR counts
toward their team's positional strength at whatever the projection says, because
the projection is the only signal the vector reads. §5 already discounts injured
players on the model tier, so the worst cases are damped, but a needs vector is a
claim about a roster over the rest of the season and treats a two-week absence
as noise. That is defensible for trades and less so for a waiver claim you are
making on Tuesday.

**No bye weeks, still.** §7's overview would happily flag a team starting three
running backs on bye in week 9, and nothing in the app maps a player to an NFL
schedule — the same gap Phases 5 and 6 recorded, for the same reason.

**The needs vector is cached, not live.** Adding a free agent in Yahoo does not
move a radar until the next sync. That is §9's bargain everywhere else in the
app and it is the right one here, but the wire is the fastest-moving surface in
the product and the staleness shows up soonest on this page.

## How the suggestion engines work

Requirement 9 asks for trades both managers would want. Requirement 10 asks
what it would take to get one particular player. They are the same search under
two different constraints, so they are one pure module — `lib/suggestions/search.ts`
— with two entry points.

Neither of them decides whether a trade is fair. `analyzeTrade` does, unchanged
since Phase 6, called here rather than reimplemented, and `lineupChange` does
the roster-context half the same way. **A suggestion the analyzer would then
argue against is a bug**, not a difference of opinion, and it is the one bug
this phase could not afford: the whole product here is a proposal the user is
being invited to send to another human. So the engines are candidate
generation, pruning and ranking on top of math the app already trusts, and the
test suite re-runs the analyzer over every suggestion the search emits to prove
it.

### The search space, said out loud

§7 sizes it and the code holds to that size:

| | |
|---|---|
| Candidate assets per team | top **8**, ranked by value tilted toward surplus |
| Packages per team | `C(8,1) + C(8,2)` = **36** |
| Candidate trades per pair | `36 × 36` = **1,296** |
| Pairs in a 12-team league | `C(12,2)` = **66** |
| **Candidate trades in total** | **85,536** |

Measured on a synthetic 12-team league with a FantasyCalc-shaped value curve,
five runs, this machine:

| | |
|---|---|
| Candidates enumerated | 85,536 |
| Rejected by the value window without being scored | **74,195** (86.7%) |
| Handed to `analyzeTrade` | 11,341 |
| Fair by value (`pct < 8%`) | 3,844 |
| …and better for **both** lineups | 422 |
| Kept after the per-pair cap | 101 |
| **Median wall clock** | **33 ms** |

Roster size does not move that number — 15, 16 and 18 players a team all come
out identical — because the top-8 cut happens first and everything after it is
a function of eight. §9's budget for a whole stage is ~60s and stage 8 already
spends most of it on the valuation; the search is a rounding error next to that,
and the stage records its own wall clock into `sync_runs` so a regression says
so where someone will read it rather than only in a test.

### The three bounds, and why each one is where it is

**Top 8 assets per team.** §7's own number, and it is not arbitrary: a redraft
roster has about eight players anyone would ask for, and the ninth is a
throw-in whose presence in a package is decided by §6's depth penalty rather
than by the search. The eight are ranked on `value × (1 + 0.35 × surplusZ)` —
deliberately the same shape as §7's waiver score, on a z clamped to ±1 for the
same reason, because it is the same claim in the other direction. The wire tilts
toward what a roster lacks; the trade table tilts toward what it can spare. The
tilt is gentle on purpose: surplus should order assets of similar price, not let
a fourth-string running back outrank a genuine star, because the star is still
the player the other manager wants to talk about.

**Two players a side.** §7 enumerates 1-for-1, 2-for-1 and 2-for-2. Allowing
three would take a pair from 1,296 candidates to 8,464 — a 6.5× bill for
packages `beta` exists specifically to discourage.

**An exact value window.** Before the analyzer is called, a package pair is
checked against a multiplicative window on their raw sums, and the window is
*derived* rather than tuned. For a side of `n` assets summing to `B`, every one
of §6's adjustments is bounded by a share of `B` — the best asset is at most
`B`, so is the median, and the headline premium is charged on a margin no bigger
than the best asset:

```
total ∈ [B(1 − β(n−1)), B(1 + α + γ)]        = [B·lo, B·hi]
fair  ⟹ min(Ta,Tb) ≥ max(Ta,Tb)(1 − band)
⟹ Bb ∈ [Ba · lo(1−band)/hi , Ba · hi/(lo(1−band))]
```

On §6's defaults that is `[0.79, 1.27] × Ba`. Nothing inside the window is
assumed fair; everything outside it is *proved* unfair without running the
analyzer — which is the only kind of pruning worth doing when the analyzer is
the definition of the answer. Both package lists are sorted by raw sum, so the
window is two binary searches rather than a scan. The test that matters here
sweeps thousands of rejected pairs through `analyzeTrade` and asserts every one
of them really is outside the band, at the default knobs and again at the far
end of every slider.

### `min`, not `sum`

§7 says to "rank by `min(Δlineup_A, Δlineup_B)`", and that choice is the whole
feature. A trade that helps one manager enormously and the other barely is not a
win-win, it is a sale — and it is exactly what maximizing the total would
select for. Maximizing the smaller of the two benefits is what makes the list
one you could actually send.

Everything after that first key is a tiebreak, and each earns its place:

| # | Key | Why |
|---|---|---|
| 1 | `min(Δa, Δb)` desc | §7's objective |
| 2 | `Δa + Δb` desc | equal for the worse-off side, more created overall |
| 3 | market share desc | §5's rule applied to a ranking, not just a badge |
| 4 | `pct` asc | the more even deal is the easier one to send |
| 5 | bodies asc | roster spots are finite (§6) |
| 6 | asset ids | nothing left to argue about, and it must not shuffle |

The first four are compared with a `1e-6` tolerance. Two packages whose minimum
gain differs in the twelfth decimal are the same package as far as a manager is
concerned, and comparing sums of floats exactly would let rounding dust reorder
the board on every sync for no reason anyone could point at.

**Three per pair, and no two with the same headliners.** Ranked purely, the top
of a pair's list is the same trade three times — a headliner swap, then that
swap with a throw-in, then it again with a different one. §10 asks for a
carousel the user *cycles* through, which is only worth building if the cards
disagree with each other. The cost is real and worth stating: a genuinely better
2-for-2 that shares its headliners with the winner is dropped, and the user sees
the simpler deal instead.

### Who is not in the search

Two exclusions, and they are different kinds of exclusion.

- **Unvalued players are dropped, and counted.** §4's rule is that the analyzer
  refuses a verdict on a package containing a `floor` value, so every candidate
  built from one is blocked before it is scored — generating them would spend
  the search's whole budget producing trades that cannot be suggested. The count
  comes back with the result and lands on the sync's warning list and the page's
  banner, because "we did not look at these" is a claim the user is owed.
- **Kickers and defenses are dropped.** §3: in redraft their trade value
  genuinely is near zero, the value engine already prices them at the market's
  own floor, and a package built around one is not a trade anybody would send.
  The analyzer *flags* them rather than blocking them, which is right for a deal
  a human assembled and wrong for one a search invented.

### Provenance, into the card

§5's rule does not stop at the analyzer. Every asset in a cached suggestion
carries its own `value_source`, the package carries the share of itself that is
market-priced, and it carries whether §6's error bars already swallow the
margin — so a package resting on the modelled tail says so on the card, before
the offer is sent rather than after. `trade_suggestions.payload` freezes all of
it alongside both lineup deltas, denormalized for the reason `saved_trades` is:
values move on every sync, and a cached recommendation that silently re-derived
would be a recommendation the app never actually made.

The `band` column has a `check (band in ('even', 'slight'))` on it. That is not
belt and braces — it is what makes "the search proposed a trade the analyzer
calls lopsided" unrepresentable rather than merely unlikely.

### The builder is the same search, differently shaped

§10 fixes one side — the player you named — and searches your own roster for
the other. `C(12,1) + C(12,2) + C(12,3)` = 298 subsets, ranked on your own
lineup delta, at most five returned, and a package that is another package plus
a throw-in is suppressed rather than shown twice.

Three decisions inside that:

- **§10's literal window is not used.** It says to keep subsets landing in
  `[0.95, 1.10] ×` the target's total; a package worth 1.10× what it is traded
  for scores `pct = 9.1%`, which the analyzer calls a **clear winner**. That is
  precisely the failure this phase is about. The fairness band wins and §10's
  window loses — the same `pct < 8%` line §7 draws for the win-win search and
  the same one the verdict panel changes color at. The asymmetry §10 was
  reaching for, that you may pay a little over to get the player you actually
  want, survives in the ranking instead of in the filter.
- **"Exclude positions of need" is a threshold, not a sign test.** Taken
  literally — any `need > 0` — it empties roughly half of every roster by
  construction, because `need` is a z-score against the league and half the
  league is on the wrong side of average at every position, including teams that
  are perfectly fine there. Half a standard deviation is where the vector starts
  making a claim rather than reporting noise. And if protecting those pieces
  leaves nothing to offer, the exclusion is dropped and the panel says so: an
  exclusion that empties a roster is a refusal to answer, not a filter.
- **Packages that cost you lineup points are shown, not hidden.** §10 says rank
  on the user's own lineup delta, and ranking is what it gets. You asked what
  this player costs; declining to tell you because your bench gets thinner is
  answering a different question.

### One is cached, one is not

The win-win search is a fold over every pair of rosters in the league, which is
the exact shape of work §9 hands to a sync stage — so it runs in stage 8, third,
after the valuation writes `player_values.ros_points` and the needs vector
writes `team_needs.surplus_z`, both of which it reads. A page that ran it per
request would run it identically per request.

The builder is not cached and that is a difference rather than an omission: its
input is a player the user picked half a second ago, and there are ~180 of them
times twelve teams asking. It runs in a server action over a board already in
memory, which costs less than a cache would. The board is re-read on the server
rather than trusted from the browser, exactly as saving a trade re-reads it: the
client sends two ids, and the packages that come back are the server's
arithmetic over the server's values.

Both engines run over `loadTradeBoard` — the analyzer's own read, which now
carries §7's `surplusZ` next to `need`. A second query shaped for the search
would be a second definition of "what is on this league's rosters", and the two
would drift.

### The stack

§10 names the interaction: "a Skiper UI carousel/stack for cycling trade
packages." It is written in the repo rather than pulled from the registry, which
is what §10 describes happening to both component libraries anyway — they are
copy-paste shadcn registries, so a vendored component is the normal outcome. It
also keeps §10's performance guardrail: the richer React Bits stack components
pull GSAP or OGL, and this is a data-dense page with no business loading a WebGL
renderer to move a card sideways. What is here is two CSS transforms and a
pointer handler.

**Only the front card is real.** The ones behind it are empty rounded
rectangles, so the accessibility tree contains exactly the trade being shown and
the arrow buttons move through the list the way a listbox would — a stack that
rendered every package would put a dozen offers in the tab order to convey
"there are more". Arrow keys, buttons and a swipe all do the same thing. Under
`prefers-reduced-motion` the transitions are cancelled outright; the offsets
stay, because they are a static diagram of "there is more behind this" rather
than motion.

Every card links into the analyzer with the trade preloaded
(`?ta=…&tb=…&a=1,2&b=3`) — ids only, never totals, so what the analyzer prices
is its own arithmetic over its own board, exactly as it is when the player is
dragged in by hand. A suggestion you cannot act on is not a suggestion, which is
the same argument §7 makes about ranking free agents Yahoo will not let you add.

### Where it falls short

**The trade deadline is still not enforced.** §6 wants it surfaced and the
suggestion engines disabled past it. There are engines to disable now, which is
the half of that sentence Phase 6 could not act on — but nothing reads
`trade_end_date` out of Yahoo's settings yet, so past the deadline this page
will happily recommend trades nobody can make. It is a one-column import, and it
is the first thing Phase 10 should pick up.

**Three players a side is out of reach, and two is a real ceiling.** §7's
enumeration stops at 2-for-2 and so does this. Consolidating three bench pieces
into one starter is a trade people genuinely make, and the search will never
find it — the builder reaches size three but only against a single fixed target,
never in an open search. The cost of lifting it is stated above: 6.5× per pair.

**Diversity is a per-pair rule, not a league-wide one.** Filtered to one team,
the board can show three suggestions built around the same player they are
shopping, because they came from three different pairs. Each is a genuinely
different offer to a different manager, which is defensible, but it reads
repetitively.

**Nothing knows what has already been offered.** A suggestion the user sent and
had rejected last week is still the top card this week, because Yahoo's trade
history is not imported and there is nowhere to record "asked, declined".

**The win-win list is cached, so it is as stale as the last sync** — and it is
staler than the needs vector in one specific way: a trade that both managers
would have liked becomes impossible the moment either of them makes a waiver
claim, and the board will not notice until the next run.

**Three-team cycles are a different search**, and they are Phase 9's — below.
They stand on this module's seams: `SuggestionTeam`, `prepareTeam`,
`windowSlice` and `compareScores`, none of which know how many teams are in a
trade.

## How the three-team search works

Requirement 11, and §7 flags it twice: a stretch, "the combinatorics are a real
trap", "low-frequency in practice". Both warnings are about the same thing and
both are earned.

A three-team trade is a **cycle** — A gives to B, B gives to C, C gives to A —
and that is not a bigger two-team trade, it is a different object. Nobody trades
with anybody directly, which is the entire reason the deal exists: it is what
you do when the manager holding the receiver you need wants a tight end, and the
tight end is on a third roster whose manager wants your running back. No pair of
those three can make a trade. All three together can.

### The rule the whole phase turns on

**Every participant is priced on their own ledger, by `analyzeTrade`.** Each
leg is one call — what this manager sends against what reaches them — and all
three have to land inside §6's fairness band independently. There is no
cycle-level fairness number anywhere in the code, and that is not tidiness:

> **Fairness is not transitive.** Two legs that are each 7% apart can close a
> ring that is 15% apart. `cycles.test.ts` builds exactly that league — prices
> climbing 8% a leg — and asserts the search rejects it *after* confirming the
> first two ledgers really were fair.

A ring balanced as a whole would call that trade even. It is not even; one of
the three is being robbed, and the check constraint on `cycle_suggestions.band`
is what makes "the search proposed a cycle one of whose members is being robbed"
unrepresentable rather than merely unlikely.

### The search space, said out loud

§7 sets the bounds — "restrict to the top 6 assets per team and ≤ 2 assets per
leg, beam search width 50" — and here is what they are bounding.

| | |
|---|---|
| Packages per team | `C(6,1) + C(6,2)` = **21** |
| Candidates per directed cycle | `21³` = **9,261** |
| Directed 3-cycles in a 12-team league | `C(12,3) × 2` = **440** |
| **Whole-league space** | **4,074,840** |
| Orientations one team can sit in | `11 × 10` = **110** |
| **Space per anchored search** | **1,018,710** |

That whole-league number is **48× Phase 8's two-team space** of 85,536, and each
candidate costs *three* analyzer runs and three lineup solves instead of two.
Phase 8 scores 11,341 survivors in ~33 ms; the same machinery over this would be
minutes, inside a stage §9 caps at ~60 seconds. So it is cut three ways.

**1. Six assets a team, not §9's eight.** Packages go as the square of the asset
count and candidates as the *cube* of the package count, so eight would take a
directed cycle from 9,261 to 46,656 — five times the bill for a roster's eighth
and ninth-best players, who are throw-ins rather than the reason anyone picks up
the phone about a three-way.

**2. Anchored.** The search is always *for one team*, and both directions round
the ring are searched because A → B → C → A and A → C → B → A move different
players. Fixing the anchor cuts 440 orientations to 110. It is also the only
question anyone asks: "find every three-way in the league" is a report nobody
reads; "what three-way could I be in" is the feature.

**3. An exact value window, twice.** The same `windowSlice` prune §9 uses — a
package pair outside `[0.79, 1.27] ×` each other's raw sum cannot reach the
fairness band whatever §6's bonuses do, so it is never constructed. The closing
leg gets it *twice over*: `Pc` has to balance the partner behind it and the
anchor in front of it, and because the window is symmetric the two constraints
collapse into one slice of one sorted list.

Only after all three does the beam appear.

### The beam, and what it gives up

The cycle is built at two depths. **Opening**: pick the anchor's package and a
partner's. That already completes the *partner's* ledger — they send `Pb` and
receive `Pa` whatever happens next — so they are fully scored here, and both
filters are exact. **Closing**: pick the third team's package, which completes
the other two ledgers at once.

Between them, the openings are cut to 50. What they are sorted on took two
attempts, and the first is worth recording because it looked right on paper:

- **ΔB alone** is a true *upper bound* on the objective `min(Δa, Δb, Δc)`, so
  ranking on it keeps the openings with the highest ceilings. It is also
  **biased**: the way to maximize ΔB is to pay the partner out of the anchor's
  own starting lineup, and the anchor is the team that asked. On the test league
  it returns a cycle worth **140** to the anchor while one worth **150** sits
  just under the cut.
- **`ΔB − strip(Pa)`** — how much the opening pays the partner, net of what
  sending `Pa` costs the anchor's lineup before anything comes back — fixes
  that. It is an estimate rather than a bound, and the claim for it is only that
  it is the best-informed one available where two thirds of the deal does not
  exist yet. `cycles.test.ts` pins the 150.

On top of it, a **per-partner cap of 6**. A plain top-50 collapses onto one
manager: if B is a good fit for the anchor, the fifty best openings are fifty
variations on trading with B. The cap is deliberately a *worse* beam by the
objective, because eleven mediocre partners beat one good one when only one of
the eleven has to say yes. Measured, it costs nothing — see below.

**A beam is not exhaustive.** This is the part that has to be said plainly: the
value windows are *prunes* and provably discard nothing, but the beam is a
heuristic truncation and an opening just under the cut may close into the best
cycle in the league and never be looked at. The stats count what was dropped,
sync stage 8 raises it as a warning, and the numbers are here rather than
implied.

### Measured

One anchored search over a synthetic twelve-team league whose positional
strengths rotate round a ring, on this machine, at the shipped bounds:

| | |
|---|---|
| Space the search stands in for | 1,018,710 |
| Openings the value window ruled out unscored | **3,936** of 4,851 (81%) |
| Openings handed to `analyzeTrade` | 915 |
| …fair for the partner *and* better for their lineup | 98 |
| Kept by the beam | **50** |
| Set aside by the beam | **48** (35 by the per-partner cap, 13 by the width) |
| Closings the two-sided window ruled out unscored | **8,174** of 10,500 (78%) |
| Closings scored | 2,326 |
| Complete cycles — fair for all three, better for all three | 109 |
| Shown | 5 |
| **Median wall clock, one anchor** | **8 ms** |
| **Median wall clock, all twelve anchors** | **93 ms** |

Roster size barely moves it — 15, 17 and 21 players a team come out within
10% — because the top-6 cut happens first and everything after it is a function
of six. §9's win-win search over the same league costs ~35 ms, so the two
together are under 0.25% of one stage's ~60s budget.

**Which is why it is cached in stage 8 rather than run on demand.** That was the
decision the measurement settled: all twelve anchors is 93 ms, so the sync can
afford the whole league, and running it for everybody buys the same thing §9's
board buys by covering every pair — knowing that two *other* managers have an
obvious three-way sitting between them is a reason to get there first. What
makes that affordable is that the cost is a function of the bounds and not of
the data: per anchor the search scores at most `11 × 21 × 21` openings and
`50 × 10 × 21` closings, whatever the league contains.

Widening the beam, same league and anchor:

| Width | Cycles found | Best cycle | Wall clock |
|---|---|---|---|
| 5 | 20 | **26.0** | 2.8 ms |
| 10 | 28 | 35.0 | 3.5 ms |
| 25 | 70 | 35.0 | 5.2 ms |
| **50** | **109** | **35.0** | **7.7 ms** |
| unbounded | 134 | 35.0 | 8.8 ms |

Two things to read off that. At §7's width of 50 the search finds 81% of the
cycles an unbounded beam finds **and the same best one** — but at width 5 it
does not, which is the beam's cost made visible rather than argued about. And
the beam is *not* what makes this affordable: unbounded costs 8.8 ms against
7.7 ms. Anchoring and the two exact windows are doing the work. Width 50 is kept
because it is §7's number and because it is nearly free, not because the search
would fall over without it.

The per-partner cap, measured on the same league: 109 cycles with it against
108 without, the same best cycle, the same three distinct partners in the menu.
It does not bind here. It is insurance against a league with one obviously
compatible partner, and it is cheap enough to keep on that basis alone.

### What is stored, and what the card says

`cycle_suggestions` is deliberately the same shape as `trade_suggestions` — a
row per suggestion, ranked, upserted under one run stamp and pruned afterwards —
with two differences that are the differences between a pair and a ring:

- **One team column, not two.** `anchor_team` does not mean "a participant", it
  means "the team this search was run for", and it is always the payload's
  `legs[0]`. The other two live in the payload, in ring order.
- **`band` is the worst leg's**, never an average of three, with the same
  `check (band in ('even', 'slight'))` §9's table carries.

The card is three equal ledgers side by side rather than the two-team card with
a column bolted on, because a cycle has no sides. Each panel carries that
manager's own percentage, their own lineup before → after, and — §5's rule,
which does not stop at the analyzer — every player's provenance badge. The
"open in the analyzer" link is *per leg*, and it says why: the analyzer prices
what one manager gives up against what they get, which is exactly the arithmetic
the panel is reporting, but it cannot show all three at once because the players
do not move between two rosters.

### Where it falls short

**The beam is not exhaustive, and no amount of framing changes that.** At the
shipped width it dropped 48 of 98 viable openings on the measured league and
found 81% of the cycles an unbounded beam finds. It happened to find the same
best one; there is no guarantee it will. If the app ever needs that guarantee,
the measurements above say the honest fix is to widen the beam rather than to
tune the sort key — unbounded costs about a millisecond more per anchor.

**The per-partner cap makes the beam worse on purpose.** 35 of those 48 dropped
openings are the cap's doing, not the width's. It buys spread across managers,
which is the right trade for a deal needing two other people to agree, but it is
a trade and this is which way it goes.

**Six assets a team is a real ceiling**, and a lower one than §9's eight. A
cycle turning on a roster's seventh-best player will not be found. That is §7's
own bound and the cube in the candidate count is why it is where it is.

**Two players a leg, same as Phase 8.** Consolidating three bench pieces into a
starter is a trade people make, and neither search will find it.

**The anchor is a team, not a player.** There is no three-team equivalent of
§10's builder — no way to say "I want *him*, find me a ring that gets him". The
seam for it exists (fix one closing package instead of enumerating them), but it
is a different search and this phase did not build it.

**A cycle needs three managers to agree**, and nothing in the app models that
its odds are worse than a two-team deal's. The menu ranks a three-way against
other three-ways only; the suggestions page shows the pair board first, which is
the ordering the plan's "low-frequency in practice" implies, but it is a layout
decision rather than anything the math knows.

**Everything Phase 8's list already says still applies**: the trade deadline is
not enforced, nothing knows what has already been offered, and the whole board
is as stale as the last sync.

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
| 8 | `compute` | The §5 value engine over everything above, the §7 needs vector over that, §9's win-win search over both, then Req. 11's cycle search once per team | — |

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
- **Math the browser reruns lives in a pure module.** `lib/sync/plan.ts`,
  `lib/trades/analyze.ts`, `lib/needs/needs.ts`, `lib/needs/lineup.ts`,
  `lib/waivers/score.ts`, `lib/suggestions/search.ts` and
  `lib/suggestions/cycles.ts` carry no transport and no `server-only`, so both
  sides run the same function over the same data. The
  corollary is a bundle rule: client components import *types* from the modules
  next door to those, never values, or a Zod parser the browser never runs ships
  to it anyway.
- **One definition of a verdict.** Anything that needs to know whether a trade
  is fair calls `analyzeTrade`; anything that needs to know what it does to a
  lineup calls `lineupChange`. The suggestion engines generate candidates and
  rank them — they do not re-derive the answer, because a second implementation
  of the verdict is a second verdict. A three-team cycle is three calls, one per
  manager, and never one call over a netted-out ring.

## Scripts

```bash
npm run dev     # dev server (turbopack)
npm run build   # production build
npm run lint    # eslint
npm test        # vitest
```
