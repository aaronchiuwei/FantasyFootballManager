-- One row per player on the waiver wire.
--
-- `league_free_agents` has always been able to list the same player twice, and
-- its sibling `league_player_values` has always been careful not to. That
-- asymmetry is the bug: resolution is many-to-one in principle -- two Yahoo
-- ids in one league can land on the same `player_id`, a stale crosswalk row
-- alongside an override -- so the pool is not unique on the thing this view is
-- keyed by.
--
-- `league_player_values` solves it with a `group by` and says why in a comment
-- about needs vectors being silently inflated. The free-agent view is read by
-- the waiver board, where a duplicate is milder but not harmless: the player
-- appears twice, and because the board takes the top 250 by projection, each
-- duplicate costs a real free agent its place on the list.
--
-- `distinct on` rather than `group by` because this view selects a dozen
-- columns off the pool row and the player, and grouping would mean an
-- aggregate around every one of them. The ordering picks the most recently
-- fetched pool row, which is the one whose injury note is current.
--
-- Restated whole because a view cannot be amended. The manual branch is
-- unchanged and needs no de-duplication: it is driven by `player_values`,
-- whose primary key is already (player_id, league_id).

drop view if exists public.league_free_agents;

create view public.league_free_agents
with (security_invoker = on) as

select *
from (
  select distinct on (pool.league_id, p.id)
    pool.league_id,
    pv.player_id,
    pv.value,
    pv.value_source,
    pv.confidence,
    pv.position_rank,
    pv.ros_points,
    pv.computed_at,
    p.full_name,
    p.position,
    p.nfl_team,
    p.injury_status,
    nullif(pool.payload ->> 'injuryNote', '') as injury_note,
    p.headshot_url,
    pp.pts_ppr as projected_pts_ppr,
    pool.fetched_at
  from public.yahoo_player_pool pool
  join public.leagues l on l.id = pool.league_id and l.source = 'yahoo'
  left join public.player_id_overrides o
    on o.source = 'yahoo' and o.source_id = pool.yahoo_player_id
  left join public.player_crosswalk cw
    on cw.source = 'yahoo' and cw.source_id = pool.yahoo_player_id
  join public.players p on p.id = coalesce(o.player_id, cw.player_id)
  join public.player_values pv
    on pv.player_id = p.id and pv.league_id = pool.league_id
  left join public.player_projections pp
    on pp.player_id = p.id and pp.season = l.season and pp.week = 0
  where pool.team_key is null
    and not exists (
      select 1
      from public.rosters r
      join public.teams t on t.id = r.team_id
      where r.player_id = p.id and t.league_id = pool.league_id
    )
  order by pool.league_id, p.id, pool.fetched_at desc
) yahoo

union all

select
  pv.league_id,
  pv.player_id,
  pv.value,
  pv.value_source,
  pv.confidence,
  pv.position_rank,
  pv.ros_points,
  pv.computed_at,
  p.full_name,
  p.position,
  p.nfl_team,
  p.injury_status,
  null::text as injury_note,
  p.headshot_url,
  pp.pts_ppr as projected_pts_ppr,
  pv.computed_at as fetched_at
from public.player_values pv
join public.leagues l on l.id = pv.league_id and l.source = 'manual'
join public.players p on p.id = pv.player_id
left join public.player_projections pp
  on pp.player_id = pv.player_id and pp.season = l.season and pp.week = 0
where not exists (
  select 1
  from public.rosters r
  join public.teams t on t.id = r.team_id
  where r.player_id = pv.player_id and t.league_id = pv.league_id
);

comment on view public.league_free_agents is
  'Available players for a league, at most one row each: Yahoo''s own list where there is one, everything priced and unrostered on a manual league. security_invoker: the underlying RLS still applies.';
