-- Weekly lineups: which seat each player holds, for one team, in one week.
--
-- `rosters.slot` has carried a lineup since Phase 3 and is the wrong shape for
-- one. It is a single current state, so a hand-kept league could say who it was
-- starting but not who it started in week 4, and setting week 9 in advance
-- meant setting today's lineup and remembering to change it back. A lineup is a
-- decision about a week; `rosters` answers a question about ownership, which is
-- not.
--
-- So this is additive, and `rosters` keeps its meaning unchanged: who is on
-- this team, and what the provider last said they were doing. An imported
-- league writes nothing here — stage 7 owns its lineups and overwrites them on
-- every sync — and a manual league writes a row per seated player per week.
--
-- The absence of rows is a state, and the important one: a week nobody has set
-- is not an empty lineup, it is an unset one, and every screen resolves it to
-- the best lineup the roster could field. That is what makes entering a season
-- of schedules useful without also entering a season of lineups.
create table if not exists public.lineups (
  team_id    uuid   not null references public.teams (id) on delete cascade,
  player_id  bigint not null references public.players (id) on delete cascade,
  week       int    not null check (week between 1 and 18),
  -- A starting slot only. The bench is the absence of a row, for the same
  -- reason a bye is the absence of a schedule row: storing every benched
  -- player every week would be fifteen rows to say nothing about ten of them.
  slot       text   not null,
  updated_at timestamptz not null default now(),
  primary key (team_id, week, player_id)
);

-- Every read is "this team's week", which this answers with a lookup. The
-- primary key already leads with it; this index is for the league-wide read
-- the matchup board makes across twelve teams at once.
create index if not exists lineups_week_idx on public.lineups (week, team_id);

alter table public.lineups enable row level security;

drop policy if exists "lineups: via league ownership" on public.lineups;
create policy "lineups: via league ownership"
  on public.lineups
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = lineups.team_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = lineups.team_id and l.user_id = (select auth.uid())
    )
  );

drop trigger if exists lineups_set_updated_at on public.lineups;
create trigger lineups_set_updated_at
  before update on public.lineups
  for each row execute function public.set_updated_at();

comment on table public.lineups is
  'A hand-kept league''s starting lineup for one team in one week. A benched player has no row; a week with no rows at all is unset, and resolves to the best lineup the roster could field.';
