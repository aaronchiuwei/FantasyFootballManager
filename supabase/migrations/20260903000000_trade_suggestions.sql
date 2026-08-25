-- Phase 8: the suggestion engines (§7 — Requirements 9 and 10).
--
-- One table, the last of §8's "derived, cached per sync" block. Nothing else
-- is needed: §10's player-based builder takes a player the user just named as
-- its input, so there is nothing about it to precompute, and it runs in a
-- server action over the same board the trade analyzer already reads.
--
-- The win-win search is the opposite case and that is why it is cached. It is
-- a fold over every *pair* of rosters in the league — 66 of them in a 12-team
-- league, ~85,000 candidate trades — which is exactly the shape of work §9
-- gives to sync stage 8, next to the valuation and the needs vector it stands
-- on. A page that ran it per request would run it identically per request.

create table if not exists public.trade_suggestions (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,

  -- The two teams, in the orientation the payload is written in: `team_a`
  -- sends the payload's `a` side. Neither is privileged — the search is over
  -- unordered pairs and a suggestion is symmetric by construction, since §9's
  -- objective is the *minimum* of the two benefits.
  team_a uuid not null references public.teams (id) on delete cascade,
  team_b uuid not null references public.teams (id) on delete cascade,

  -- Both packages frozen whole: every player's name, value and — §5's
  -- first-class field — the provenance of that value. Denormalized for the
  -- same reason `saved_trades.payload` is, and one more besides. Values move
  -- on every sync, and a cached suggestion that silently re-derived would be a
  -- recommendation the app never actually made. The lineup deltas that make it
  -- a *win-win* rather than merely a fair trade ride along, because they are
  -- computed against rosters as they stood and cannot be recovered later.
  payload jsonb not null,

  -- §9's ranking key: `min(Δlineup_A, Δlineup_B)`, in rest-of-season projected
  -- points. Hoisted out of the payload so the board can be ordered without
  -- opening it. §8's sketch names this column `score` and this is what the
  -- score is — "maximizing the minimum benefit is what makes it genuinely
  -- win-win rather than merely balanced."
  score numeric not null,

  -- §6's fairness band, hoisted for the same reason `saved_trades.verdict` is.
  -- Only the two fair bands can appear: §9 filters to `pct < 8%` and the
  -- constraint is what makes "the search proposed a trade the analyzer calls
  -- lopsided" unrepresentable rather than merely unlikely.
  band text not null check (band in ('even', 'slight')),

  -- Position within this pair, 1 = best. Part of the key so a sync upserts
  -- over the previous run's rows in place, which is what lets the stage be
  -- interrupted without leaving a league with no suggestions at all.
  rank int not null check (rank >= 1),

  -- §8 names this column and it doubles as the run stamp: a cached suggestion
  -- is written fresh by the stage that computed it, so the moment it was
  -- created *is* the moment it was computed. Rows are upserted under one
  -- timestamp and the leftovers pruned afterwards, the same order the
  -- valuation and the needs vector use.
  created_at timestamptz not null default now(),

  unique (league_id, team_a, team_b, rank)
);

create index if not exists trade_suggestions_league_score_idx
  on public.trade_suggestions (league_id, score desc);

-- "What could I get out of my own roster" is the question this table is asked
-- almost every time, and a team sits on either side of a pair.
create index if not exists trade_suggestions_team_a_idx
  on public.trade_suggestions (team_a);
create index if not exists trade_suggestions_team_b_idx
  on public.trade_suggestions (team_b);

comment on table public.trade_suggestions is
  'The §9 win-win search, cached by sync stage 8: trades that are fair by value and improve both starting lineups.';

alter table public.trade_suggestions enable row level security;

-- League ownership, like every other derived table. The two team columns are
-- foreign keys into a table the user may not own, so the league is what the
-- policy checks — and stage 8 writes these under the service role anyway,
-- authorized by the `sync_runs` row an authenticated owner created (§9).
drop policy if exists "trade_suggestions: via league ownership" on public.trade_suggestions;
create policy "trade_suggestions: via league ownership"
  on public.trade_suggestions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = trade_suggestions.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = trade_suggestions.league_id and l.user_id = (select auth.uid())
    )
  );
