-- Phase 7: the needs vector, the league overview and the waiver wire
-- (§7 — Requirements 7 and 8).
--
-- One derived table from §8, one column the value engine was already computing
-- and throwing away, and one view so the waiver screen can ask "who is
-- actually available in this league" in a single read.
--
-- Nothing here caches a recommendation. §7's waiver score is
-- `ros × (1 + λ × need)` — a pure function of the two numbers below and one
-- slider — so it is recomputed in the browser on every nudge, exactly the way
-- §6's trade math is. What is cached is the *needs vector*, because it is a
-- fold over every roster in the league and §9 gives stage 8 the job.

-- ---------------------------------------------------------------------------
-- rest-of-season points, promoted to a stored column
-- ---------------------------------------------------------------------------

-- §5's value engine already computes this for every player it prices: the
-- season projection, blended with actual pace at `min(0.7, games/10)` once
-- games have been played, then scaled by `weeks_remaining / 17` because a
-- redraft asset is a claim on the weeks that are left and nothing more.
--
-- Until now it was an intermediate that died inside the engine, and the value
-- was the only thing that survived. §7 needs the quantity itself — a needs
-- vector is a fold over projections, not over prices, and §7 is emphatic that
-- the waiver wire ranks on projection because "trade value is the wrong tool
-- for this question". Storing it here rather than re-deriving it downstream is
-- what keeps one definition of "rest of season" in the app instead of two that
-- drift.
alter table public.player_values
  add column if not exists ros_points numeric;

comment on column public.player_values.ros_points is
  'Rest-of-season projected points behind this value (§5 blend + weeks-remaining scaling). Null when nothing projects the player.';

-- ---------------------------------------------------------------------------
-- the needs vector (§7, §8)
-- ---------------------------------------------------------------------------

create table if not exists public.team_needs (
  team_id  uuid not null references public.teams (id) on delete cascade,
  position text not null check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),

  -- §7: `strength(p) = Σ projections of starters(p)`, where `starters(p)` is
  -- the top `k_p` at the position and `k_p` comes from the league's own slots
  -- with flex distributed across the positions that fill it — so a standard
  -- W/R/T league counts 2.5 running backs, and the half is the third one.
  strength numeric not null,

  -- `z(p) = (strength − league_mean) / league_sd`, over the twelve teams in
  -- this league and no one else. Zero when the league has no spread at that
  -- position to measure against.
  z_score  numeric not null,

  -- `need(p) = −z(p)`. Positive means weakness, which is the sign convention
  -- §7's waiver score `ros × (1 + λ × need)` is written against.
  need     numeric not null,

  -- §7: "Σ projections of players above the starter requirement" — the depth
  -- behind the starters, and the pool §9 and §10 will trade out of.
  surplus  numeric not null,

  -- Surplus in raw points is not comparable across positions: a quarterback
  -- outscores a tight end for reasons that have nothing to do with depth. The
  -- same cross-team normalization applied to strength is applied to surplus so
  -- "this team's biggest surplus" is a claim that survives the comparison.
  -- §8's sketch names six columns; this is the seventh, and it exists because
  -- the six cannot answer the question §7 asks of them.
  surplus_z numeric not null,

  -- Share of the roster at this position that carries a projection at all.
  -- The provenance of a needs verdict: a player with no projection is exactly
  -- §5's `floor` tier — no market price and nothing to model from — and they
  -- contribute nothing to a strength that is a sum. Without this the absence
  -- is invisible, which is the failure mode §4 spends the whole crosswalk
  -- avoiding.
  confidence numeric not null default 1 check (confidence between 0 and 1),

  computed_at timestamptz not null default now(),

  primary key (team_id, position)
);

comment on table public.team_needs is
  'The §7 needs vector, recomputed by sync stage 8. Powers the league overview, waiver scoring and (Phase 8) the suggestion engines.';

alter table public.team_needs enable row level security;

-- A team is not user-scoped on its own; ownership is two joins away, the same
-- way `rosters` reaches it.
drop policy if exists "team_needs: via league ownership" on public.team_needs;
create policy "team_needs: via league ownership"
  on public.team_needs
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = team_needs.team_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = team_needs.team_id and l.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- the values screen's read model, with rest-of-season points added
-- ---------------------------------------------------------------------------

-- Unchanged from Phase 3 apart from `ros_points`. Restated whole because a
-- view cannot gain a column any other way.
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
) on r.player_id = pv.player_id and t.league_id = pv.league_id;

comment on view public.league_player_values is
  'Values joined to player identity and league ownership. security_invoker: the underlying RLS still applies.';

-- ---------------------------------------------------------------------------
-- who is actually available (§7)
-- ---------------------------------------------------------------------------

-- "Not on a roster" and "available in this league" are different claims, and
-- the waiver screen must make the second one. `player_values` prices everyone
-- the app can render — roughly six hundred players — most of whom Yahoo has
-- never listed as available in any league. Yahoo's own answer is already
-- stored: stage 6 parks the top ~150 free agents it ranks in
-- `yahoo_player_pool` with a null `team_key` (§3 caps the pagination there).
--
-- Joining that to identity is exactly §4's ladder in SQL: the manual override
-- wins, the persisted crosswalk answers the rest, and a Yahoo player who
-- resolved to nobody has no row here — they are on the identity screen
-- instead, which is where an unmatched player belongs.
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
  -- A pool row that has since been rostered is stale, not available. Cheaper
  -- to exclude here than to explain on the screen.
  and not exists (
    select 1
    from public.rosters r
    join public.teams t on t.id = r.team_id
    where r.player_id = p.id and t.league_id = pool.league_id
  );

comment on view public.league_free_agents is
  'Yahoo''s available list for a league, resolved to players and priced. security_invoker: the underlying RLS still applies.';
