# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fantasy football managers in Yahoo redraft leagues, evaluating a roster and a
possible trade. Confirmed by the user: the app is used **equally** on phone and
on desktop — glanceable checks on a phone, and long analytical sessions on a
desktop where the values board and trade analyzer are worked in depth. A single
user is always acting inside one league at a time, as one team among ~10–12.

## Product Purpose

Turn "is this trade good?" into an answered question. The app imports a Yahoo
league, attaches a market-grounded dollar value to every player on every roster,
and then does the arithmetic the manager would otherwise do by feel: what each
side gives up, what each side gains, whether the result is fair, and which
trades in the league are available and mutually good.

Success is a manager accepting or declining a trade with a reason they could
state out loud.

## Positioning

Values are **market-grounded and provenance-tracked**, not opinion. Every value
carries where it came from — a real market source, a model fallback, or
unvalued — and the UI is required to show that distinction rather than
laundering all three into one confident number. On top of that: a needs vector
per team (what a roster is actually short of), which turns trade search from
"who is worth the most" into "who wins by trading with whom", including
three-team cycles no manager finds by hand.

## Operating Context

- Yahoo OAuth2 connect → league import → one-button multi-stage sync.
- Player identity across sources is resolved by a crosswalk; unmatched players
  are a real, visible state, not an error.
- Routes in use: landing, login/signup, dashboard, leagues list, and per league:
  overview, values, waivers, trade, suggestions, identity, and player detail.
- Weekly rhythm: waiver decisions early week, trade negotiation midweek, roster
  checks on Sunday.

## Capabilities and Constraints

Confirmed capabilities: Supabase auth + RLS; Yahoo OAuth2 with encrypted tokens;
league and team import; Sleeper / FantasyCalc / DynastyProcess value adapters;
player-identity crosswalk with a manual identity screen; staged sync with live
progress; season and per-week stats; trade analyzer with bonus math and fairness
bands (fair / tilted / lopsided); per-team needs vector; waiver wire
recommendations; win-win trade search; player-based package builder; three-team
cycle search with per-leg verdicts; saved trades.

Confirmed absences that must never be fabricated in UI: **no NFL schedule
source**, therefore no bye weeks and no playoff schedule; **no trade deadline**
read from Yahoo; the three-team cycle search is **bounded beam search, not
exhaustive**, and must not be presented as complete.

Terminology in use: value, provenance, needs vector, fairness band, verdict,
win-win, package, cycle, waiver wire, crosswalk, sync stage.

Stack constraint: Next.js 15 App Router, React 19, TypeScript, Tailwind v4,
shadcn/ui, Supabase. Server Components by default. `prefers-reduced-motion` is
honored app-wide and must remain so.

## Brand Commitments

Name: **Fantasy Football Manager**. No logo, wordmark, or brand color was
declared binding by the user; the incumbent emerald theme is explicitly **not**
a commitment — the user chose to replace the visual world.

## Evidence on Hand

Real: the running application and its data model; README.md and PLAN.md
document every capability and limit above. No customers, testimonials, pricing,
benchmarks, or press exist — none may be invented. Player names and values shown
in any design work come from real sources at runtime; any placeholder roster
used while building is synthetic and must be labeled as such.

## Product Principles

1. **Provenance is a first-class field.** A number's source is part of the
   number. Never render a modeled or missing value as if it were a market one.
2. **The verdict is the product.** Every analytical surface must resolve to a
   statement a manager can act on, not a pile of figures.
3. **Show the limits.** Bounded search, unmatched players, and missing schedule
   data are stated in the interface, not hidden behind confidence.
4. **One league at a time.** Wayfinding always answers "which league, which
   team, which week" without a trip back to a front page.
5. **Phone and desktop are both first-class.** Dense analytical surfaces must
   recompose, not merely shrink.

## Accessibility & Inclusion

`prefers-reduced-motion` is respected app-wide today and remains required.
Fairness bands and provenance must never be encoded by color alone — each needs
a text or shape carrier as well.
