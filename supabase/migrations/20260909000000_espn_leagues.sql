-- ESPN leagues: a third way in, landing on the same rows as the other two.
--
-- Yahoo is an OAuth app and a token; a manual league is a form. ESPN is
-- neither. Its fantasy API is unauthenticated for a public league and
-- cookie-authenticated for a private one -- the same two cookies the browser
-- holds, `SWID` and `espn_s2` -- and there is no OAuth app to register and no
-- key to wait weeks for. So the entry is: a league id, a season, and (only if
-- the league is private) a pair of cookies pasted out of the browser.
--
-- What is deliberately *not* new here is the destination. An ESPN league is a
-- `leagues` row with `source = 'espn'`, its teams are `teams` rows, its pool
-- lands in `yahoo_player_pool` and its players resolve through
-- `player_crosswalk` -- exactly as Yahoo's do. The one thing that had to be
-- taught the difference is the crosswalk's `source`, because an ESPN player id
-- and a Yahoo player id are both small integers that mean different people.

-- ---------------------------------------------------------------------------
-- where a league came from
-- ---------------------------------------------------------------------------

alter table public.leagues
  drop constraint if exists leagues_source_check;

alter table public.leagues
  add constraint leagues_source_check check (source in ('yahoo', 'manual', 'espn'));

comment on column public.leagues.source is
  'yahoo / espn = imported over that provider''s API; manual = entered by hand. Sync stages 6 and 7 are skipped for manual.';

-- An ESPN league carries a synthetic key on the Yahoo column, for the same
-- reason a manual one does: `yahoo_league_key` is `not null` and uniquely
-- indexed with `user_id`, and the import upserts on that index. Unlike the
-- manual key this one is *derived* rather than random -- `espn:<season>:<id>`
-- -- because re-connecting the same ESPN league must refresh the row it made
-- last time rather than opening a second board for it.
comment on column public.leagues.yahoo_league_key is
  'Yahoo''s own key, `espn:<season>:<leagueId>`, or `manual:<uuid>`.';

comment on column public.teams.yahoo_team_key is
  'Yahoo''s own key, `espn:<season>:<leagueId>:t<teamId>`, or `manual:<uuid>`.';

-- ---------------------------------------------------------------------------
-- espn_credentials
-- ---------------------------------------------------------------------------

-- The private-league half. Modelled on `yahoo_tokens` down to the trust
-- level: RLS on, no policy, grants revoked -- only the service role reads it,
-- so a compromised anon key cannot lift someone's ESPN session cookies (§2).
--
-- These are session cookies for the user's whole ESPN account, not a scoped
-- token, which is a real difference from the Yahoo path and the reason they
-- are encrypted with the same application-level key and never returned to the
-- browser. There is nothing to refresh: ESPN expires them on its own schedule
-- and the only repair is to paste new ones, so `needs_reauth` is set when a
-- request comes back 401 and the UI asks for exactly that.
create table if not exists public.espn_credentials (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  -- The `{...}` account id ESPN puts in the SWID cookie. Also how a team's
  -- `owners` array names the signed-in user, which is how the import knows
  -- which of the twelve teams is theirs.
  swid_enc     text        not null,
  espn_s2_enc  text        not null,
  needs_reauth boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.espn_credentials is
  'Encrypted ESPN session cookies (SWID + espn_s2). RLS enabled with no policy: service role only.';

alter table public.espn_credentials enable row level security;

revoke all on table public.espn_credentials from anon, authenticated;

drop trigger if exists espn_credentials_set_updated_at on public.espn_credentials;
create trigger espn_credentials_set_updated_at
  before update on public.espn_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- the waiver wire's read model, now for three kinds of league
-- ---------------------------------------------------------------------------

-- Restated whole again, for the same reason as last time: a view cannot gain a
-- branch any other way. Only two things changed in the imported half.
--
-- First, the league filter is `source in ('yahoo', 'espn')` -- both providers
-- park their pool in `yahoo_player_pool` and both report an available list, so
-- the honest pool is the provider's own answer in both cases.
--
-- Second, the crosswalk and override joins key on `l.source` instead of the
-- literal 'yahoo'. That is the whole reason the column values were chosen to
-- match the crosswalk's `source` values: player 4046 is Patrick Mahomes at
-- Yahoo and someone else entirely at ESPN, and joining on the wrong one would
-- not fail -- it would quietly price the wrong player.
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
  on o.source = l.source and o.source_id = pool.yahoo_player_id
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
