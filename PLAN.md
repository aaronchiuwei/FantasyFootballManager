# Fantasy Football Team Manager — Implementation Plan

Yahoo Fantasy Football league companion. Next.js on Vercel, Supabase for auth + data,
shadcn/ui base skinned with Skiper UI + React Bits.

---

## 0. Research findings that shaped this plan

I probed the live external APIs before designing. Two findings changed the architecture materially:

| Check | Result | Consequence |
|---|---|---|
| `api.fantasycalc.com/values/current` (redraft, 1QB, 12tm, PPR) | **200 OK — but only 192 players**, QB/RB/WR/TE only. Values 10,739 → 1. No K/DEF. Same 192 for `numTeams=14`, `numQbs=2`. Dynasty returns 474. | Verified a hard ceiling, not a bad param: the dynasty call's 474 rows carry `redraftValue` nonzero for **exactly the same 192**, matching the redraft call 100%. Covers every rostered skill player in a 12-team league (~156 needed) plus ~36 top FAs — but **no K/DEF and no deep waiver wire**. Needs a second, model-derived tier. |
| Sleeper `yahoo_id` coverage on fantasy-relevant players | **Badly stale.** 99–100% for players who entered ≤2020, 62% for 2022, 34% for 2024, **1% for 2025, 0% for 2026**. 133 of FantasyCalc's top 192 have no `yahoo_id` — including Ja'Marr Chase. | **Yahoo→Sleeper cannot join on `yahoo_id`.** Player identity resolution is the single largest technical risk and needs its own subsystem. |
| FantasyCalc payload | Carries `sleeperId`, `espnId`, `mflId`, `fleaflickerId`, plus `trend30Day`, `maybeTier`, `maybeAdp`, `maybeRosterPercent`. | FantasyCalc→Sleeper join is **free and exact** via `sleeperId` (0 misses in top 192). Only the *Yahoo* side is hard. |
| Sleeper stats / projections | `/v1/stats/nfl/regular/{yr}`, `/v1/projections/nfl/regular/{yr}` (season totals), `/projections/nfl/{yr}/{wk}` (weekly) all 200 OK. 2026 season projections present for 100% of FantasyCalc's top 192. | Satisfies Requirement 4 (current + projected) and feeds the value model. |
| Sleeper player master | 12,224 players, **14.6 MB** | Too big to pull on every sync. Cache with a ≥24h TTL. |
| `/v1/state/nfl` | `season: 2026, season_type: "pre", week: 3` | It is **preseason right now**. "Current season stats" will be empty until Week 1. UI and value model must fall back to 2025 stats as prior-season context. |
| Yahoo OAuth2 | `request_auth` / `get_token`. Access token **1 hour**; refresh token long-lived, survives password changes. Basic auth header + form-encoded body. | Server-side token refresh on every sync. Tokens never touch the browser. |
| Skiper UI / React Bits | Both are **shadcn-registry copy-paste** libraries, not npm runtime deps. React Bits: MIT + Commons Clause. Skiper UI: MIT, 24+ free / 54+ pro. | shadcn/ui + Tailwind is the mandatory substrate. Components are vendored into the repo, so they are ours to edit. |

**The headline design consequence:** player value is not a single API passthrough. It is a
**two-tier blended engine** — market values where the market exists, a calibrated
projection-derived model everywhere else — mapped onto one scale. Sections 5 and 6 cover this.

---

## 1. Assumptions

Stated so they can be corrected cheaply. None of these block starting work.

1. **Redraft — confirmed, and treated as the design target, not a configurable mode.**
   Dynasty is explicitly out of scope. `is_dynasty` is still read from Yahoo so the app can
   warn rather than silently mis-value if pointed at a keeper league, but no dynasty-specific
   code path gets built. This removes the youth premium, draft capital, and rookie-pick
   valuation from the design entirely.
2. **League scoring is read from Yahoo, not hardcoded.** PPR value, QB count (superflex),
   and team count are pulled from Yahoo league settings and passed straight into the
   FantasyCalc query params. No manual configuration.
3. **Personal-scale multi-tenant.** Built so any user can sign in and attach their own league
   (proper RLS, no shared state), but capacity-planned for tens of users, not thousands.
4. **You will register a Yahoo developer app** and hold the client ID/secret. Required — there
   is no way around it for private league data.
5. **Trade evaluation is value-first, context-second.** Requirement 3 says trades are
   fundamentally summed values; that is the primary verdict. Roster-context impact is shown
   alongside it as a secondary signal, because the suggestion engines (7/9/10) need it.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js 15 App Router on Vercel                             │
│  ├─ (app) RSC pages: dashboard, teams, players, trade, wire  │
│  ├─ /api/yahoo/callback   OAuth code exchange                │
│  ├─ /api/sync/[stage]     staged sync workers (Node runtime) │
│  └─ /api/trade/*          analyze / suggest / build          │
└──────────────────────────────────────────────────────────────┘
        │ @supabase/ssr (cookie session)      │ service-role key (server only)
        ▼                                     ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase                                                    │
│  ├─ Auth (email + OAuth)                                     │
│  ├─ Postgres + RLS  (all tables user-scoped)                 │
│  ├─ Realtime  → live sync progress to the UI                 │
│  └─ Vault/pgsodium → encrypted Yahoo refresh tokens          │
└──────────────────────────────────────────────────────────────┘
        ▲               ▲                  ▲
   Yahoo Fantasy   FantasyCalc          Sleeper
   (league truth)  (market values)   (ids/stats/proj)
```

**Rules of the road**

- Yahoo tokens live server-side only, encrypted, reachable solely by the service role.
  The browser never sees a Yahoo token.
- All heavy computation (value calibration, trade search) runs server-side and is **cached in
  Postgres**, not recomputed per request. The trade analyzer itself is pure and fast enough to
  run on every keystroke against cached values.
- Every external fetch goes through one `lib/sources/*` adapter with typed Zod parsing, so a
  provider change is a one-file change.

---

## 3. Data sources and contracts

| Concern | Source | Endpoint | Cadence |
|---|---|---|---|
| League truth (rosters, standings, matchups, FAs, settings) | Yahoo Fantasy v2 | `fantasysports.yahooapis.com/fantasy/v2/...?format=json` | Every sync |
| Market player values | FantasyCalc | `/values/current?isDynasty&numQbs&numTeams&ppr` | Every sync |
| Player master + ID crosswalk | Sleeper | `/v1/players/nfl` | ≥24h TTL |
| Season + weekly actual stats | Sleeper | `/v1/stats/nfl/regular/{season}` | Every sync |
| Season + weekly projections | Sleeper | `/v1/projections/nfl/regular/{season}`, `/projections/nfl/{season}/{week}` | Every sync |
| Season/week clock | Sleeper | `/v1/state/nfl` | Every sync |

Yahoo calls to implement (all with `?format=json`; Yahoo defaults to XML):

```
/users;use_login=1/games;game_keys=nfl/leagues        → discover user's leagues
/league/{key};out=settings,standings,teams            → one call, three resources
/league/{key}/teams;out=roster                        → all rosters
/league/{key}/players;status=A;start={n};count=25     → free agents, paginated
/league/{key}/scoreboard;week={n}                     → matchups
```

### Alternative value sources — measured, not assumed

I tested every credible alternative against the same league config:

| Source | Redraft players | K/DEF? | Access | Notes |
|---|---|---|---|---|
| **FantasyCalc** | 192 | ✗ | Free JSON API | Real trade-market data. Hard ceiling — the dynasty call's 474 rows carry `redraftValue` for exactly the same 192. |
| **KeepTradeCut** | 326 | ✓ 44 K + 32 DST | HTML scrape | **Not a trade-value source.** The field is `startSitValue` — a crowd *start/sit preference* score. It prices the best K/DST at 47% of the best skill player, which is nonsense as trade value but correct as startability. Different quantity, not a second opinion. |
| ~~DynastyProcess `values.csv`~~ | 703 (dynasty) | ✗ | GitHub CSV | **Dropped** — dynasty-scaled, wrong for redraft. Its `db_playerids.csv` crosswalk is still essential (§ identity). |
| **FantasyPros ECR** (via DynastyProcess mirror) | **~770 relevant** | **✓ 40 K + 32 DST** | GitHub CSV | Ranks, not values — convertible via a calibrated curve. Broadest coverage available. |
| ESPN `kona_player_info` | — | — | Needs `view` params | Viable but redundant given the above. |

### The decision

**FantasyCalc is the single source of trade value. Nothing is blended into it.**

The earlier idea of running KTC alongside it was wrong, and the numbers show why. FantasyCalc's
redraft values are derived from *actual completed redraft trades* — they measure exactly the
quantity the trade analyzer needs. KTC's `startSitValue` measures weekly startability. Both are
legitimate; they are answers to different questions. Averaging them would corrupt the analyzer
with a number that means nothing, and it would make `α` uncalibratable because the blended
curve's superstar premium would be unknown.

There is a second, practical reason to stay single-source: a trade verdict has to be *arguable*
with a leaguemate. "FantasyCalc has this at 4,200" is a citation. "Our internal blend says 4,200"
is not.

**Resolution order per player:**

| Order | Source | Covers | Marked |
|---|---|---|---|
| 1 | **FantasyCalc redraft value** | 192 skill players — every rostered skill player in a 12-team league | `market` |
| 2 | **VOR model**, isotonically calibrated to FantasyCalc's scale | the skill-player tail below rank 192 | `model` |
| 3 | **Nominal floor, flagged non-tradeable** | K and DEF | `floor` |

**K/DEF is not a gap to fill.** In redraft, kickers and defenses are streamed off waivers every
week — their trade value genuinely *is* near zero. The right answer is a nominal floor value
plus an explicit "not a trade asset" flag, not a hunt for a source that prices them. That
retires the problem KTC was brought in to solve.

**Dropped from v1:** FantasyPros ECR (the model tier already covers the tail, and the waiver
wire ranks on projections rather than values), and KTC as a value source. KTC remains
*optional later* for a genuinely different feature — start/sit lineup advice — where its
numbers are the right ones.

**Caveat that survives:** FantasyCalc is undocumented. Cache last-good values in Postgres so an
outage degrades to stale rather than broken, and keep the adapter boundary clean so KTC or ECR
can be promoted to a value source if it ever disappears.

---

Use Yahoo's `;out=` sub-resource composition aggressively — it collapses what would be dozens
of round trips into a handful, which matters because Yahoo's rate limits are undocumented and
unforgiving. Free-agent pagination is the only unavoidably chatty part; cap it at the top ~150
available players ranked by Yahoo, which is far more than any waiver recommendation needs.

---

## 4. Player identity crosswalk — the critical subsystem

This is where this kind of project usually dies. Budget real time for it.

The join we want is `yahoo_player_id → sleeper_id → fantasycalc_id`. The right half is exact
and free (FantasyCalc ships `sleeperId`; 0 misses in the top 192). **The left half has no
reliable key** — Sleeper's `yahoo_id` is 0% populated for 2026 rookies and 1% for 2025.

**Resolution ladder**, applied in order, first hit wins:

1. **Manual override** — `player_id_overrides` table, seeded empty, always consulted first.
2. **DynastyProcess `db_playerids.csv`** — 12,480 rows carrying `yahoo_id`, `sleeper_id`,
   `ktc_id`, `fantasypros_id` and `mfl_id` side by side. A purpose-built crosswalk that
   resolves **77% of FantasyCalc's top 192 to a Yahoo ID, against Sleeper's 31%**. Seed the
   crosswalk table from this file on first run; it roughly halves the fuzzy-matching workload.
3. **Sleeper `yahoo_id` direct** — fills a few remaining veteran gaps. Cheap, exact.
4. **Normalized name + position + NFL team.** Normalize: lowercase, strip punctuation and
   diacritics, drop suffixes (`Jr/Sr/II/III/IV/V`), collapse whitespace. `D'Andre` → `dandre`,
   `Ja'Marr Chase` → `jamarrchase` (this is exactly Sleeper's own `search_full_name`, so match
   against that field directly).
5. **Normalized name + position**, team ignored — catches in-season trades and roster churn.
6. **Fuzzy**: trigram similarity ≥ 0.88 on normalized name, *gated* on matching position, plus
   a birth-date or draft-year tiebreak when FantasyCalc supplies `maybeBirthday`/`maybeDraftInfo`.
7. **Unresolved** — written to `unmatched_players` with the Yahoo payload attached.

Every resolution is **persisted** in `player_crosswalk` with its `match_method` and
`confidence`, so step 3–5 work is done once per player, not once per sync.

**No public source has Yahoo IDs for current rookies.** DynastyProcess is 0% for the 2025 and
2026 draft classes; FantasyPros ships a `yahoo_id` column that is entirely empty (0 of 1,355
redraft rows). Every 2025–26 rookie — Jeanty, Hampton, McMillan, Egbuka, Loveland — resolves
only by name. This is not a gap any provider will close, so the name ladder is permanent
infrastructure, not a stopgap. The saving grace: rookies have distinctive names and one team
each, so they are the *easiest* population to name-match reliably.

**Admin resolution UI.** A small page listing unmatched players with candidate suggestions and
a one-click "these are the same person" action that writes an override. Expect ~5–20 unmatched
players at season start (rookies, practice-squad callups, defenses) and near zero thereafter.
Without this screen, a single unmatched player silently corrupts a trade evaluation — with it,
the failure is visible and fixable in seconds.

**Non-negotiable UI rule:** any player with no resolved value renders as an explicit
"unvalued" chip and the trade analyzer **refuses to declare a verdict** until it is resolved.
Silently treating a missing value as 0 is the worst possible failure mode.

Team defenses and kickers need special handling — Yahoo represents DEF as a team entity, not a
player. Map them by NFL team abbreviation directly.

---

## 5. The value engine

Requirement 3 asks for "a numeric value for every player." FantasyCalc gives us 192 of them.
The other ~2,000 relevant players — the entire waiver wire, every kicker, every defense — need
values on the *same scale* or nothing downstream works.

### Tier A — market value (authoritative)

FantasyCalc `value`, queried with params derived from the actual Yahoo league settings.
Covers the top ~192 QB/RB/WR/TE. Stored with `value_source = 'market'`.

### How much is actually being estimated?

Less than the raw count suggests. Trade value is extremely concentrated:

| Coverage | Share of all league trade value | Value of the last player |
|---|---|---|
| Top 24 | 44.5% | 5,124 |
| Top 50 | 70.2% | 3,055 |
| Top 100 | **92.3%** | 934 |
| Top 150 | **99.1%** | 191 |
| Top 192 | 100.0% | 1 |

FantasyCalc's 192 covers **every rostered skill player** in a 12-team league (~156 required)
plus roughly 36 of the best free agents. Everything the model tier handles sits below rank 192,
where the market itself prices players in the low hundreds against a #1 of 10,739 — player #150
is already worth 1.8% of the top asset.

**So every trade you would realistically propose is 100% market-valued.** The model tier is not
propping up the trade analyzer; it exists for display completeness and so that K/DEF and deep
bench pieces do not render as a literal zero.

### Tier B — model value (calibrated fallback)

Derived from Sleeper season projections via **value over replacement**:

```
replacement_rank(pos) = teams × (starters_at_pos + flex_share(pos))
baseline(pos)         = projected_points of the player at replacement_rank(pos)
VOR(p)                = projected_points(p) − baseline(position(p))
```

`flex_share` distributes each league's FLEX slots across RB/WR/TE by historical fill rate
(~0.5 RB / 0.4 WR / 0.1 TE for a standard flex), read from the league's actual roster slots.

VOR is in fantasy points, not market units. Bridge the scales by **fitting on the overlap**:

```
overlap  = players with BOTH a FantasyCalc value and a VOR   (~192 rows)
fit      = isotonic regression  VOR → market_value           (monotone by construction)
value(p) = fit(VOR(p))  for Tier B players
```

Isotonic rather than linear because FantasyCalc's value curve is steeply convex at the top —
a linear fit would badly overvalue mid-tier players. Monotonicity guarantees a better
projection never produces a lower value.

Three guardrails, each earning its place:

- **Clamp at the seam.** Tier B values are capped at the lowest Tier A value in their position
  band, so a waiver-wire flyer can never leapfrog a rostered starter that the market has priced.
- **Cap K/DEF.** They have no market anchor at all and VOR flatters them (kickers score
  consistently). Cap them at a configurable ceiling — roughly the QB2/TE2 tier — and mark them
  `value_source = 'model_capped'`.
- **Preseason degradation.** Right now (2026 preseason, Week 3) there are no current-season
  actuals. The model runs on projections alone until Week 4, then begins blending actuals in at
  a weight that rises with games played: `w_actual = min(0.7, games_played / 10)`.

### Provenance is a first-class field

Every value carries `value_source ∈ {market, model, model_capped}` and a confidence score,
surfaced in the UI as a small badge. A trade built on model values is a *fuzzier* trade and
the user deserves to know which is which. This one decision is what keeps the tool honest.

---

## 6. Trade math

### Best-player bonus (Requirement 6)

A flat additive bonus is trivially exploitable — it makes every package want exactly one
superstar regardless of scale. Use a **proportional** bonus instead:

```
side_base    = Σ value(p) for p in side
top          = argmax value(p) in side
bonus        = α × value(top)                          α default 0.15
depth_penalty= β × max(0, n − 1) × median_value(side)   β default 0.03,  n = players in side
side_total   = side_base + bonus − depth_penalty
```

Applied **per side**, so when both packages are headlined by comparable studs the effect
largely cancels — which is correct. It only moves the needle when one side has the clear best
asset, which is exactly the consolidation premium the requirement describes.

Optionally, an extra `γ` (default 0.05) for the single best player in the *entire* trade,
capturing "the true top player in the deal." Both `α`, `β`, `γ` are per-league tunables stored
in settings and exposed as sliders — let the user's league norms calibrate them.

The `depth_penalty` is the necessary counterweight: without it the calculator will happily
approve 4-for-1 packages that no real manager would accept, because roster spots are finite.

### The two markets price the season very differently

This is the finding that most affects `α`. Comparing the value curves directly:

| Coverage | FantasyCalc share of total value | KeepTradeCut share |
|---|---|---|
| Top 50 | 70.2% | 30.5% |
| Top 100 | **92.3%** | **53.0%** |
| Top 150 | 99.1% | 70.7% |
| Full list | 100% (192 players) | 100% (326 players) |

FantasyCalc is **steeply top-heavy** — it already bakes a large superstar premium into the
curve itself. KeepTradeCut is far **flatter** — depth retains real value. That is the actual
reason the two correlate at only 0.858: not noise, but structurally different pricing.

**Consequence for Requirement 6:** FantasyCalc's curve *already* encodes a large superstar
premium — the top 100 hold 92.3% of all value. A big `α` on top of that charges the premium
twice and the analyzer will over-approve every 2-for-1. Start at **`α ≈ 0.08`**, not the 0.15
a flat-curve source would want, and treat the golden-file tests in §13 as the real calibration
mechanism. This is the single most important tuning decision in the app.

### Redraft-specific adjustments

Redraft changes what a trade *means*, and these are cheap to add once the value table exists:

- **Value decays with weeks remaining.** A redraft asset is a claim on the rest of the season
  and nothing more. Market sources price this in automatically; the model tier must apply a
  `weeks_remaining / 17` scaling or it will drift high late in the year. After the league's
  trade deadline, trade value is moot — surface the deadline prominently and disable the
  suggestion engines past it.
- **Bye weeks are a real cost.** Irrelevant in dynasty, material in redraft. KTC ships
  `byeWeek` for 359 of 376 players. The analyzer should flag when a trade leaves a team
  starting-thin in a specific week — *"this leaves you with three RBs on bye in Week 9."*
- **Playoff schedule (Weeks 15–17)** is a legitimate tiebreaker between otherwise-even
  packages, and a genuinely differentiating feature versus a generic value calculator.
- **Injuries weight far heavier.** A season-ending injury zeroes redraft value while barely
  denting dynasty value. Sleeper's `injury_status` must feed the value engine directly, not
  just decorate the UI.
- **The waiver wire matters disproportionately.** In redraft it is the main roster-improvement
  channel, which raises Requirement 7 from a nice-to-have to a headline feature — and reinforces
  ranking it on rest-of-season projection rather than trade value.

### Fairness verdict

```
Δ    = A_total − B_total
pct  = |Δ| / max(A_total, B_total)

pct < 3%    → Even
pct < 8%    → Slight edge
pct < 15%   → Clear winner
otherwise   → Lopsided
```

Displayed as an animated balance beam that tips proportionally to `pct` — the trade analyzer's
signature interaction, and the natural home for a React Bits spring animation.

### Roster-context delta (secondary)

Alongside the value verdict, compute each team's **starting-lineup projected points before vs.
after** the trade. This is what makes a trade *good for you* as opposed to merely *even*, and
it is the objective function the suggestion engines in Section 7 optimize.

---

## 7. Team needs model and the suggestion engines

### Needs vector (powers Requirements 7, 8, 9, 10)

For every team and position:

```
starters(p)   = top k_p players by projection at position p
strength(p)   = Σ projections of starters(p)
z(p)          = (strength(p) − league_mean(p)) / league_sd(p)
need(p)       = −z(p)              positive ⇒ weakness
surplus(p)    = Σ projections of players above the starter requirement
```

This single structure drives all four remaining features, which is why it is worth computing
once per sync and caching.

### 8 — League team overview
Grid of all teams. Each card shows a positional strength radar plus the two largest surpluses
and two largest needs, sourced straight from the needs vector. Staggered card entrance,
shared-element transition into the team detail page.

### 7 — Waiver wire suggestions
**Rank by rest-of-season projection, not by estimated trade value:**

```
score = ros_projected_points(p) × (1 + λ × need(position(p)))
```

Free agents sit almost entirely below FantasyCalc's coverage, so ranking them by a *derived*
trade value would mean sorting on an estimate of a number that is near zero for all of them —
noise amplified into a ranking. Projections are the real signal here and are available for
100% of these players directly. Trade value is the wrong tool for this question; "who should I
add" is a projection question, not a market question.

Estimated values still appear on these players' cards for continuity, always with the
provenance badge — they just do not drive the ordering.

### 9 — Win-win trade suggestions
For each team pair `(A, B)`, take each side's top ~8 tradeable assets weighted toward surplus
positions. Enumerate 1-for-1, 2-for-1 and 2-for-2 packages: `36 × 36 ≈ 1,300` combinations per
pair, `~85,000` for a 12-team league — trivial server-side, and cached per sync.

Filter to `pct < 8%` (fair by value), then rank by **`min(Δlineup_A, Δlineup_B)`**. Maximizing
the *minimum* benefit is what makes it genuinely win-win rather than merely balanced — a trade
that helps A enormously and B slightly will lose to one that helps both solidly.

### 10 — Player-based trade builder
Given a target player `T` on team `B`: compute `B`'s required total (T's value plus the bonus
math from Section 6), then search subsets of the user's roster of size ≤ 3 landing in
`[0.95, 1.10] ×` that total. Prefer pieces from surplus positions, exclude players at positions
of need, rank by the user's own lineup delta. Return 3–5 alternative packages rather than one
answer — offering a *menu* is far more useful than a single verdict.

### 11 — Three-team trades (stretch)
Cyclic search `A → B → C → A`. Restrict to the top 6 assets per team and ≤ 2 assets per leg,
beam search width 50. Each team must independently land inside the fairness band on its own
in-vs-out. Ship only after 9 and 10 are solid; the combinatorics are a real trap and the
feature is low-frequency in practice.

---

## 8. Database schema

```sql
-- identity
profiles(id uuid pk → auth.users, email, created_at)
yahoo_tokens(user_id uuid pk, access_token_enc, refresh_token_enc,
             expires_at timestamptz, yahoo_guid)          -- service role only, no client policy

-- league
leagues(id, user_id, yahoo_league_key unique, name, season, num_teams,
        scoring_type, ppr numeric, num_qbs int, roster_slots jsonb, is_dynasty bool)
teams(id, league_id, yahoo_team_key, name, manager_name, logo_url,
      is_users_team bool, wins, losses, ties, points_for, points_against, rank)
rosters(team_id, player_id, slot text, is_starter bool, primary key(team_id, player_id))
matchups(league_id, week, team_a, team_b, points_a, points_b)

-- players (global, not user-scoped)
players(id bigserial pk, sleeper_id text unique, full_name, search_name,
        position, nfl_team, age, years_exp, status, injury_status, headshot_url)
player_crosswalk(player_id, source text, source_id text, match_method text,
                 confidence numeric, primary key(source, source_id))
player_id_overrides(source, source_id, player_id, created_by, note)   -- manual, wins over all
unmatched_players(id, league_id, yahoo_player_id, payload jsonb, resolved_at)

player_values(player_id, league_id, value int, base_value int, value_source text,
              confidence numeric, overall_rank, position_rank, trend_30d, tier,
              computed_at, primary key(player_id, league_id))
player_stats(player_id, season, week, stats jsonb, pts_ppr numeric,
             primary key(player_id, season, week))         -- week 0 = season total
player_projections(player_id, season, week, stats jsonb, pts_ppr numeric,
                   primary key(player_id, season, week))

-- derived, cached per sync
team_needs(team_id, position, strength, z_score, need, surplus)
trade_suggestions(id, league_id, team_a, team_b, payload jsonb, score, created_at)

-- user artifacts
saved_trades(id, user_id, league_id, payload jsonb, verdict, note, created_at)
league_settings(league_id pk, alpha numeric default 0.15, beta numeric default 0.03,
                gamma numeric default 0.05, lambda numeric default 0.5)
sync_runs(id, user_id, league_id, status, stages jsonb, started_at, finished_at, error)
```

**RLS on every user-scoped table** (`user_id = auth.uid()`, or league ownership via join).
`players`, `player_stats`, `player_projections` and `player_crosswalk` are global read-only
reference data — readable by any authenticated user, writable only by the service role.
`yahoo_tokens` gets **no client policy at all**.

---

## 9. One-button sync (Requirement 2)

One button, but **not** one HTTP request. Yahoo pagination plus a 14.6 MB Sleeper payload will
blow past any sane serverless timeout, so the sync is a staged pipeline with a durable
progress record.

```
POST /api/sync            → creates sync_runs row, kicks off stage 1
POST /api/sync/[stage]    → each stage runs, writes progress, chains the next
```

| # | Stage | Work | Skippable |
|---|---|---|---|
| 1 | `state` | Sleeper NFL state — season, week, phase | no |
| 2 | `players` | Sleeper player master, 14.6 MB | yes, if <24h old |
| 3 | `values` | FantasyCalc, params from league settings | no |
| 4 | `projections` | Sleeper season + current week | no |
| 5 | `stats` | Sleeper season + current week actuals | no |
| 6 | `yahoo` | Refresh token, then league/settings/standings/teams/rosters/matchups/FAs | no |
| 7 | `resolve` | Crosswalk any unmatched Yahoo players | no |
| 8 | `compute` | Value calibration, needs vectors, cached trade suggestions | no |

Each stage updates `sync_runs.stages`; the client subscribes via **Supabase Realtime** and
renders a live animated checklist. This turns the least glamorous requirement into one of the
most satisfying moments in the app — and it is the honest way to handle a job that legitimately
takes 20–40 seconds.

Stages are idempotent and independently retryable. A failure in stage 6 leaves stages 1–5
committed, and the UI offers "retry from failed stage" rather than forcing a full redo.

Set `maxDuration` on the Node runtime and keep any single stage under ~60s. Optionally add a
Vercel Cron nightly sync so the app is warm when the user opens it.

---

## 10. UI/UX

Substrate: **Next.js App Router + Tailwind + shadcn/ui**. Both component libraries are
shadcn-registry copy-paste, so components are vendored into `components/ui/` and are ours to
modify — no runtime dependency, no version churn.

```bash
npx shadcn@latest add @react-bits/BlurText-TS-TW
npx shadcn@latest add @skiper-ui/skiper40
```

| Surface | Treatment |
|---|---|
| Landing / auth | React Bits animated background + text reveal. High polish, low complexity. |
| Sync button | Progress ring → staged checklist, driven by Realtime. Haptic-feeling spring on completion. |
| Trade analyzer | Two drop zones, animated balance beam tipping by `pct`, values counting up on change, verdict crossfade. The centerpiece. |
| Player cards | Shared-element transition into detail. Current vs. projected stats as animated bars. Value badge with 30-day trend arrow. |
| League overview | Staggered card grid, positional strength radar per team. |
| Suggestions | Skiper UI carousel/stack for cycling trade packages. |

**Performance guardrails.** React Bits' richer components pull GSAP, Three.js and OGL. Those
are heavy. Dynamic-import them, keep WebGL effects off the data-dense pages entirely, and
respect `prefers-reduced-motion` throughout — a trade analyzer that fights the user is worse
than a plain one. Animation serves comprehension here (the balance beam *is* the verdict);
where it does not, cut it.

Licensing note: React Bits is MIT + **Commons Clause** — free for personal and commercial use,
but you may not sell the components themselves. Fine for this app. Skiper UI's premium tier is
paid; the 24+ free components are MIT.

---

## 11. Delivery phases

Each phase ends in something demonstrable.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundation** | Next.js + Tailwind + shadcn, Supabase project, auth, RLS baseline, design tokens | Sign in, session persists, protected route works |
| **1. Yahoo link** | Dev app registration, OAuth flow, encrypted token storage, league discovery + import | Your real league name and 12 teams render from live Yahoo data |
| **2. Data + identity** | Sleeper/FantasyCalc adapters, **crosswalk subsystem**, admin resolution UI | ≥95% of rostered players auto-resolve; the rest are resolvable in one click |
| **3. Value engine** | VOR, isotonic calibration, guardrails, provenance | Every rostered player *and* the FA pool has a value with a source badge |
| **4. One-button sync** | Staged pipeline, `sync_runs`, Realtime progress UI | One click refreshes everything; a killed stage retries cleanly |
| **5. Stats** | Season + projected stats, player detail pages | Req. 4 complete |
| **6. Trade analyzer** | Bonus math, fairness bands, balance-beam UI, saved trades | Req. 3, 5, 6 complete |
| **7. Needs + waivers + overview** | Needs vector, league overview, waiver recommendations | Req. 7, 8 complete |
| **8. Suggestion engines** | Win-win search, player-based builder | Req. 9, 10 complete |
| **9. Three-team** *(stretch)* | Cyclic beam search | Req. 11 |
| **10. Polish** | Motion pass, reduced-motion, mobile, error states, empty states | Ship |

Phases 2 and 3 are the ones that carry real technical risk and the ones most likely to be
underestimated. Phases 6–8 are comparatively mechanical once the value engine is trustworthy —
they are all just arithmetic over a good values table.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Yahoo↔Sleeper identity mismatch** | **High** | Resolution ladder + persisted crosswalk + admin UI + hard "unvalued" UI state. Never silently value a player at 0. |
| **FantasyCalc covers only 192 players, no K/DEF** | **High** | Tier B model values with isotonic calibration (Section 5). Already designed in, not a patch. |
| **FantasyCalc is an undocumented API** | Medium | Single adapter behind a typed interface; cache last-good values in Postgres so an outage degrades to stale rather than broken. Swap target if it disappears. |
| Yahoo undocumented rate limits | Medium | `;out=` composition, FA pagination capped, staged sync, exponential backoff, nightly cron to spread load. |
| Vercel function timeouts | Medium | Staged pipeline; no stage exceeds ~60s; 14.6 MB player pull gated behind a 24h TTL. |
| Preseason has no current-season stats | Low | Detected from `/v1/state/nfl`; fall back to 2025 actuals as context and label the UI accordingly. |
| Animation libraries bloat the bundle | Low | Dynamic imports, no WebGL on data pages, `prefers-reduced-motion`. |
| Yahoo refresh token revoked | Low | Detect 401 on refresh, mark the league needing re-auth, prompt re-link rather than failing the sync silently. |

---

## 13. Validation

- **Crosswalk**: assert ≥95% auto-resolution across your league's full roster set plus the top
  150 free agents; every miss must appear in `unmatched_players`, never be silently dropped.
- **Value engine**: the isotonic fit's rank correlation against FantasyCalc on the overlap set
  should be ≥0.98 — if it is not, the VOR inputs are wrong.
- **Trade analyzer**: golden-file tests on hand-checked trades, including the adversarial ones —
  4-for-1 packages, two-superstar swaps, K/DEF-inflated junk — to confirm `α`/`β` are sane.
- **Sync**: kill a stage mid-run and confirm resume-from-failure works.
- **Seam check**: confirm no Tier B player outranks a Tier A player at the same position.

---

## 14. First three concrete steps

1. Register the Yahoo developer app (`https://developer.yahoo.com/apps/create/`) with redirect
   `https://<project>.vercel.app/api/yahoo/callback` and a localhost variant. Scope: `fspt-r`
   (read) — read-only is sufficient for everything in this plan.
2. Scaffold Next.js + Supabase + shadcn and land the auth + RLS baseline (Phase 0).
3. Build the crosswalk subsystem against your real league before building any feature on top of
   it. It is the foundation everything else stands on, and it is the piece most likely to
   surprise you.
