-- Phase 3: the value engine (§5). The tables themselves landed in Phase 2;
-- what is added here is the shape the engine's contract depends on — the
-- provenance enum, the ranking indexes, and one view so the values screen can
-- filter and sort in Postgres rather than in JavaScript.

-- §5 "provenance is a first-class field". A value with an unknown source is
-- worse than no value, because everything downstream treats it as trustworthy.
--   market       — FantasyCalc, a real completed-trade price
--   model        — VOR isotonically calibrated onto FantasyCalc's scale
--   model_capped — K/DEF, modelled then held under the QB2/TE2 ceiling
--   floor        — nominal: no market price and no projection to model from
alter table public.player_values
  drop constraint if exists player_values_value_source_check;

alter table public.player_values
  add constraint player_values_value_source_check
  check (value_source in ('market', 'model', 'model_capped', 'floor'));

-- §4's non-negotiable rule, enforced by the database rather than by habit: a
-- player is never worth literally zero, because a zero is indistinguishable
-- from a missing value once it reaches trade math.
alter table public.player_values
  drop constraint if exists player_values_value_positive_check;

alter table public.player_values
  add constraint player_values_value_positive_check check (value > 0);

create index if not exists player_values_league_value_idx
  on public.player_values (league_id, value desc);

create index if not exists player_values_league_rank_idx
  on public.player_values (league_id, overall_rank);

-- Both stats tables are keyed (player_id, season, week), so a "the whole
-- league's week 0" read — which is every read the value engine makes — has no
-- usable prefix without this.
create index if not exists player_stats_season_week_idx
  on public.player_stats (season, week);

create index if not exists player_projections_season_week_idx
  on public.player_projections (season, week);

-- ---------------------------------------------------------------------------
-- the values screen's read model
-- ---------------------------------------------------------------------------

-- A value is only legible next to who owns the player and what position they
-- play, and those live in three different tables. `security_invoker` keeps the
-- underlying RLS in force: this view widens no access, it only saves the app
-- from paging two thousand rows into Node to join them by hand.
drop view if exists public.league_player_values;

create view public.league_player_values
with (security_invoker = on) as
select
  pv.league_id,
  pv.player_id,
  pv.value,
  pv.base_value,
  pv.value_source,
  pv.confidence,
  pv.overall_rank,
  pv.position_rank,
  pv.trend_30d,
  pv.tier,
  pv.computed_at,
  p.full_name,
  p.position,
  p.nfl_team,
  p.injury_status,
  p.headshot_url,
  pp.pts_ppr as projected_pts_ppr,
  r.slot,
  r.is_starter,
  t.id   as team_id,
  t.name as team_name,
  t.is_users_team
from public.player_values pv
join public.players p on p.id = pv.player_id
join public.leagues l on l.id = pv.league_id
-- Season projection alongside the value: below the seam most of the model tier
-- honestly collapses onto the market's own floor, and projected points are
-- what actually separates one waiver flyer from the next.
left join public.player_projections pp
  on pp.player_id = pv.player_id and pp.season = l.season and pp.week = 0
-- Parenthesized so the league filter is part of the join, not a post-filter:
-- a player rostered in the user's *other* league must not shadow this one's
-- free-agent row.
left join (
  public.rosters r
  join public.teams t on t.id = r.team_id
) on r.player_id = pv.player_id and t.league_id = pv.league_id;

comment on view public.league_player_values is
  'Values joined to player identity and league ownership. security_invoker: the underlying RLS still applies.';
