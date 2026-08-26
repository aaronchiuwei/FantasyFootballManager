-- Player headshots.
--
-- `players.headshot_url` has existed since the first players migration and the
-- master sync has always written it, so this migration is not adding a picture
-- source. It fixes the two reasons the pictures were not usable.
--
-- **A team defense had a URL that answers 403.** The column was filled for
-- every row with `/content/nfl/players/{sleeper_id}.jpg`, and a DEF's
-- `sleeper_id` is the team abbreviation. Sleeper does not serve a player
-- portrait for `PHI`; it serves a team logo at a different path entirely. The
-- writer (`lib/players/headshot.ts`) now branches, and this backfills the rows
-- that were written before it did rather than waiting a day for the master's
-- TTL to turn over.
--
-- **The waiver wire could not see the column.** `league_free_agents` selects
-- player identity column by column, and `headshot_url` was not among them --
-- so the one screen that is entirely about players nobody has looked at yet
-- was the one screen that could not show their faces. `league_player_values`
-- already carried it.

update public.players
set headshot_url =
  'https://sleepercdn.com/images/team_logos/nfl/'
  || lower(coalesce(nullif(nfl_team, ''), sleeper_id))
  || '.png'
where position in ('DEF', 'DST')
  and coalesce(nullif(nfl_team, ''), sleeper_id) is not null;

-- Recreated rather than altered: Postgres will not add a column to the middle
-- of a view, and the column order here is identity's, not an append.
drop view if exists public.league_free_agents;

create view public.league_free_agents
with (security_invoker = on) as
select
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
  p.headshot_url,
  pp.pts_ppr as projected_pts_ppr,
  pool.fetched_at
from public.yahoo_player_pool pool
join public.leagues l on l.id = pool.league_id
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
  );

comment on view public.league_free_agents is
  'Yahoo''s available list for a league, resolved to players and priced. security_invoker: the underlying RLS still applies.';
