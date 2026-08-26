-- Yahoo's injury note.
--
-- `yahoo_player_pool.payload` has carried `injuryNote` since stage 6 first
-- wrote it -- `parsePlayer` reads Yahoo's `injury_note` and the whole
-- `YahooPlayer` is persisted verbatim. Nothing ever read it back, so the one
-- thing the app knew that Sleeper does not say was sitting in a JSONB column
-- nobody selected from.
--
-- It is worth reading back because it answers a different question than
-- `players.injury_status` does. Sleeper says *how available* a player is (Q,
-- OUT, IR); Yahoo says *why* ("Knee", "Hamstring", "Concussion"). A manager
-- deciding whether to buy the dip on a Questionable back is asking the second
-- question, and until now the app could only answer the first.
--
-- Free text never touches the value engine -- §6's multipliers key off the
-- status, and a body part is not a number. This is label only, on the surfaces
-- that already print the badge.
--
-- Scope: league-scoped, because the pool is. The open trade analyzer runs
-- without a Yahoo import at all and reads `players` directly, so it has no
-- note to show and does not gain one here.

-- ---------------------------------------------------------------------------
-- the values screen's read model
-- ---------------------------------------------------------------------------

-- Restated whole because a view cannot gain a column any other way. Unchanged
-- from the needs/waivers migration apart from `injury_note`.
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
  pv.ros_points,
  pv.computed_at,
  p.full_name,
  p.position,
  p.nfl_team,
  p.injury_status,
  note.injury_note,
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
left join public.player_projections pp
  on pp.player_id = pv.player_id and pp.season = l.season and pp.week = 0
left join (
  public.rosters r
  join public.teams t on t.id = r.team_id
) on r.player_id = pv.player_id and t.league_id = pv.league_id
-- Grouped before it is joined, and that is the whole point. Resolution is
-- many-to-one in principle -- two Yahoo ids in one league can land on the same
-- `player_id` (a stale crosswalk row alongside an override, say) -- so a plain
-- join to the pool could emit a player twice. This view is what
-- `lib/needs/store.ts` sums position strength from, where a duplicated row is
-- not a cosmetic bug: it would silently inflate a team's need vector. The
-- `group by` makes at most one row per (league, player) a property of the
-- relation rather than a thing to hope for, and `min` picks deterministically
-- when two pool rows disagree.
--
-- Grouped rather than written as a correlated scalar subquery so the planner
-- builds one hash instead of re-scanning the pool once per priced player. RLS
-- on `yahoo_player_pool` is what bounds the scan -- under `security_invoker`
-- it sees only the caller's own leagues.
left join (
  select
    ypp.league_id,
    coalesce(o.player_id, cw.player_id) as player_id,
    min(nullif(ypp.payload ->> 'injuryNote', '')) as injury_note
  from public.yahoo_player_pool ypp
  left join public.player_id_overrides o
    on o.source = 'yahoo' and o.source_id = ypp.yahoo_player_id
  left join public.player_crosswalk cw
    on cw.source = 'yahoo' and cw.source_id = ypp.yahoo_player_id
  where coalesce(o.player_id, cw.player_id) is not null
  group by 1, 2
) note on note.league_id = pv.league_id and note.player_id = pv.player_id;

comment on view public.league_player_values is
  'Values joined to player identity and league ownership, with Yahoo''s injury note. security_invoker: the underlying RLS still applies.';

-- ---------------------------------------------------------------------------
-- the waiver wire's read model
-- ---------------------------------------------------------------------------

-- This one already has the pool in hand -- it is the driving table -- so the
-- note is a plain column reference, no resolution needed.
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
  nullif(pool.payload ->> 'injuryNote', '') as injury_note,
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
  'Yahoo''s available list for a league, resolved and priced, with Yahoo''s injury note. security_invoker: the underlying RLS still applies.';
