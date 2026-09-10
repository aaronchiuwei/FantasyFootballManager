-- Manual player-id overrides, scoped to the league that made the decision.
--
-- `player_id_overrides` was keyed `(source, source_id)` and its policies let
-- any authenticated user read, insert and delete every row in it. It is the
-- one table in the schema that never got a tenant: `unmatched_players` sits
-- beside it league-scoped, `player_values` is league-scoped, and the identity
-- screen writes both. The original migration said so plainly -- "for a
-- personal-scale app every signed-in user is a trusted operator" -- which
-- stops being true the moment signups are open, and they are.
--
-- The leak is not hypothetical and it is the quiet kind. A stranger resolving
-- "A. Brown" to the wrong Brown in their own league rewrote the mapping for
-- every league, and the next sync repriced that player on boards the stranger
-- cannot see and did not know existed. No error, no failed sync: a wrong
-- number, which is the failure this app exists to avoid.
--
-- So the override gets a `league_id` and the ownership policies the rest of
-- the schema already uses. That is also the more honest model rather than
-- merely the safer one. Resolution is a judgement about a *pool*, the pool is
-- per league, and two managers who read the same Yahoo id differently should
-- each get their own answer instead of the last writer winning globally.

-- ---------------------------------------------------------------------------
-- the column, and what to do with the rows that predate it
-- ---------------------------------------------------------------------------

alter table public.player_id_overrides
  drop constraint if exists player_id_overrides_pkey;

alter table public.player_id_overrides
  add column if not exists league_id uuid references public.leagues (id) on delete cascade;

-- Existing rows carry no league, so they are fanned out to every league whose
-- pool actually contains that id: one decision becomes one row per board it
-- was already affecting. That preserves what each existing board resolves to
-- today while ending the shared write, which is the whole point -- the rows
-- stop being one mutable global and become each league's own copy.
--
-- Reading and writing the same table in one statement is safe here: the SELECT
-- sees the snapshot taken when the statement began, so the rows this INSERT
-- adds are not visible to its own scan.
insert into public.player_id_overrides
  (league_id, source, source_id, player_id, created_by, note, created_at)
select distinct
  pool.league_id,
  o.source,
  o.source_id,
  o.player_id,
  o.created_by,
  o.note,
  o.created_at
from public.player_id_overrides o
join public.yahoo_player_pool pool
  on pool.yahoo_player_id = o.source_id
join public.leagues l
  on l.id = pool.league_id and l.source = o.source
where o.league_id is null
on conflict do nothing;

-- An override for an id no league has ever seen resolved nothing, so there is
-- nothing to keep attributing.
delete from public.player_id_overrides where league_id is null;

alter table public.player_id_overrides
  alter column league_id set not null;

alter table public.player_id_overrides
  add constraint player_id_overrides_pkey primary key (league_id, source, source_id);

comment on table public.player_id_overrides is
  'Manual "these are the same person" decisions from the identity screen. Scoped to the league that made the call; outranks every other rung of the ladder for that league only.';
comment on column public.player_id_overrides.league_id is
  'The league whose pool this decision was made about. Ownership of this row is ownership of that league.';

-- ---------------------------------------------------------------------------
-- the second half of the same leak
-- ---------------------------------------------------------------------------

-- `applyOverride` also upserted the decision into `player_crosswalk` with
-- `match_method = 'override'`, and that table is global by design -- it is the
-- shared identity map, seeded from DynastyProcess and Sleeper, service-role
-- write only. Copying a per-user judgement into it handed the override the
-- reach this migration is taking away, so the write is gone from the code and
-- the rows it already wrote go with it.
--
-- Nothing is lost. The league that made each decision now holds it in
-- `player_id_overrides`, which both the resolver and the views consult ahead
-- of the crosswalk; every other league falls back to name matching, which is
-- what it would have done had the stranger never clicked.
delete from public.player_crosswalk where match_method = 'override';

-- ---------------------------------------------------------------------------
-- policies: ownership, proven by a join to leagues
-- ---------------------------------------------------------------------------

drop policy if exists "player_id_overrides: read all" on public.player_id_overrides;
drop policy if exists "player_id_overrides: authenticated write" on public.player_id_overrides;
drop policy if exists "player_id_overrides: authenticated delete" on public.player_id_overrides;

drop policy if exists "player_id_overrides: read via league ownership" on public.player_id_overrides;
create policy "player_id_overrides: read via league ownership"
  on public.player_id_overrides
  for select
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = player_id_overrides.league_id and l.user_id = (select auth.uid())
    )
  );

drop policy if exists "player_id_overrides: insert via league ownership" on public.player_id_overrides;
create policy "player_id_overrides: insert via league ownership"
  on public.player_id_overrides
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = player_id_overrides.league_id and l.user_id = (select auth.uid())
    )
  );

-- Still no update policy, and still on purpose: a re-decision deletes and
-- re-inserts rather than editing, so `created_by` and `created_at` always
-- describe the decision that is actually in force.
drop policy if exists "player_id_overrides: delete via league ownership" on public.player_id_overrides;
create policy "player_id_overrides: delete via league ownership"
  on public.player_id_overrides
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = player_id_overrides.league_id and l.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- the two views that resolve through an override
-- ---------------------------------------------------------------------------

-- Both are restated whole, as every change to these has had to be: a view
-- cannot gain a join condition any other way. The only edit in each is
-- `o.league_id = <the league already in hand>` on the override join, which
-- turns a global lookup into the league's own.

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
    on o.league_id = ypp.league_id
   and o.source = 'yahoo'
   and o.source_id = ypp.yahoo_player_id
  left join public.player_crosswalk cw
    on cw.source = 'yahoo' and cw.source_id = ypp.yahoo_player_id
  where coalesce(o.player_id, cw.player_id) is not null
  group by 1, 2
) note on note.league_id = pv.league_id and note.player_id = pv.player_id;

comment on view public.league_player_values is
  'Values joined to player identity and league ownership, with Yahoo''s injury note. security_invoker: the underlying RLS still applies.';

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
join public.leagues l
  on l.id = pool.league_id and l.source in ('yahoo', 'espn')
left join public.player_id_overrides o
  on o.league_id = pool.league_id
 and o.source = l.source
 and o.source_id = pool.yahoo_player_id
left join public.player_crosswalk cw
  on cw.source = l.source and cw.source_id = pool.yahoo_player_id
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
  'Available players for a league: the provider''s own list for Yahoo and ESPN, everything priced and unrostered on a manual league. security_invoker: the underlying RLS still applies.';
