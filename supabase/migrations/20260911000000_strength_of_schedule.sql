-- Strength of schedule: the NFL schedule, and how much each defense gives up
-- to each fantasy position.
--
-- Both are global reference data, exactly like `players` and `player_stats`:
-- readable by any signed-in user, written only by the service role inside the
-- sync (§8). Neither is keyed to a league, because neither is a fact about one
-- -- what a league contributes is its own PPR modifier, applied on read.

-- ---------------------------------------------------------------------------
-- who plays whom
-- ---------------------------------------------------------------------------

-- Stored one row per *team* per week rather than one row per game, because
-- every question asked of it is "who does this team play in week N" and that
-- shape answers it with a lookup instead of an or-clause. The consequence
-- worth stating: a bye is the absence of a row, which is exactly how the
-- weekly grid already renders "no game" for a stat line.
create table if not exists public.nfl_schedule (
  season   int  not null,
  week     int  not null check (week between 1 and 18),
  team     text not null,
  opponent text not null,
  is_home  boolean not null,
  kickoff  date,
  primary key (season, week, team)
);

create index if not exists nfl_schedule_season_team_idx
  on public.nfl_schedule (season, team);

alter table public.nfl_schedule enable row level security;

drop policy if exists "nfl_schedule: read all" on public.nfl_schedule;
create policy "nfl_schedule: read all"
  on public.nfl_schedule
  for select
  to authenticated
  using (true);

comment on table public.nfl_schedule is
  'One row per team per week. A bye is a missing row, not a row with a null opponent.';

-- ---------------------------------------------------------------------------
-- what each team scored, and what each defense gave up
-- ---------------------------------------------------------------------------

-- The season aggregate behind every strength-of-schedule reading: for one
-- team, at one position, either the points its own players produced ('for') or
-- the points its defense allowed opposing players at that position ('against').
--
-- Points are stored in two pieces rather than one so §1.2's rule survives:
-- scoring is applied on read with the league's own PPR modifier, never trusted
-- from a stored total. `points_std` is the reception-free score and
-- `receptions` is the count, so any league's number is
-- `points_std + ppr * receptions` -- the same reconstruction the value engine
-- does on a season total, at team scale.
--
-- 32 teams x 4 positions x 2 sides = 256 rows a season. It is an aggregate
-- rather than a game log because a game log would need the *player's* team in
-- that week, which our own `player_stats` cannot say: the master carries the
-- team a player is on today, and a quarter of last season's player-weeks were
-- played somewhere else.
create table if not exists public.nfl_position_scoring (
  season      int  not null,
  team        text not null,
  position    text not null check (position in ('QB', 'RB', 'WR', 'TE')),
  side        text not null check (side in ('for', 'against')),
  -- Weeks the team actually played, so the per-game figure divides by games
  -- rather than by the length of the season.
  games       int  not null default 0,
  points_std  numeric not null default 0,
  receptions  numeric not null default 0,
  computed_at timestamptz not null default now(),
  primary key (season, team, position, side)
);

alter table public.nfl_position_scoring enable row level security;

drop policy if exists "nfl_position_scoring: read all" on public.nfl_position_scoring;
create policy "nfl_position_scoring: read all"
  on public.nfl_position_scoring
  for select
  to authenticated
  using (true);

comment on column public.nfl_position_scoring.side is
  '''for'' = points this team''s players produced at that position; ''against'' = points its defense allowed opposing players there.';

comment on column public.nfl_position_scoring.points_std is
  'Reception-free score. A league''s own figure is points_std + ppr * receptions, per §1.2.';
