-- Phase 5: stats (§ Phase 5, Req. 4 — "current and projected stats").
--
-- The tables themselves landed in Phase 2, already keyed (player_id, season,
-- week) with `week = 0` reserved for the season total. Nothing has ever been
-- written at a week other than 0, so what this migration adds is the shape a
-- *weekly* grid needs: a bound on the week key, and a record of which weeks
-- have actually been pulled.

-- Sleeper's regular season is 18 weeks; a week beyond that is a bug in a path
-- template, not data. Week 0 stays legal — it is the season total.
alter table public.player_stats
  drop constraint if exists player_stats_week_range_check;

alter table public.player_stats
  add constraint player_stats_week_range_check check (week between 0 and 18);

alter table public.player_projections
  drop constraint if exists player_projections_week_range_check;

alter table public.player_projections
  add constraint player_projections_week_range_check check (week between 0 and 18);

comment on column public.player_stats.week is
  'NFL week; 0 is the season total. Weeks 1-18 are the game log.';

comment on column public.player_projections.week is
  'NFL week; 0 is the season total. Weeks 1-18 are the weekly projection grid.';

-- ---------------------------------------------------------------------------
-- what has been pulled, and when
-- ---------------------------------------------------------------------------

-- Weekly stats are ~1,000 rows per week per kind, and a sync that re-pulls
-- eighteen weeks of a *finished* season on every run is paying for data that
-- can no longer change. This table is how stages 4 and 5 know what they
-- already have — the same "stages hand off through Postgres" rule the rest of
-- §9 runs on, applied to the decision of whether to fetch at all.
--
-- It also does a second job the UI needs: a week with no row here has never
-- been pulled, which is a different statement from a week with a row and no
-- points. Requirement 4 is about showing stats honestly, and "not fetched yet"
-- and "did not play" must not render the same way.
create table if not exists public.stat_coverage (
  season     int  not null,
  week       int  not null check (week between 0 and 18),
  -- 'actual' → player_stats, 'projected' → player_projections.
  kind       text not null check (kind in ('actual', 'projected')),
  -- Rows written for that week, after the empty placeholder lines Sleeper
  -- returns for every player in the league are dropped.
  players    int  not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (season, kind, week)
);

-- Global reference data, exactly like the two tables it describes: readable by
-- any signed-in user, written only by the service role inside the sync (§8).
alter table public.stat_coverage enable row level security;

drop policy if exists "stat_coverage: read all" on public.stat_coverage;
create policy "stat_coverage: read all"
  on public.stat_coverage
  for select
  to authenticated
  using (true);

comment on table public.stat_coverage is
  'Which (season, week, kind) stat pulls have landed. Read by sync stages 4 and 5 to skip frozen weeks, and by the player detail page to distinguish "not fetched" from "did not play".';
