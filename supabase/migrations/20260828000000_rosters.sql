-- Phase 2, part two: the resolved roster, plus the one player attribute the
-- crosswalk's fuzzy tiebreak needs (§4 step 6).

alter table public.players add column if not exists birth_date date;

-- A roster row only exists once identity is resolved: `player_id` is a real FK
-- into `players`, never a Yahoo id. Anything Yahoo reports that we could not
-- resolve lands in `unmatched_players` instead, so an unresolved player is
-- visibly missing rather than silently valued at zero (§4).
create table if not exists public.rosters (
  team_id         uuid   not null references public.teams (id) on delete cascade,
  player_id       bigint not null references public.players (id) on delete cascade,
  -- Yahoo's `selected_position`: a starting slot, BN, or an IR variant.
  slot            text,
  is_starter      boolean not null default false,
  -- Kept for traceability back to the Yahoo payload a row came from.
  yahoo_player_id text,
  updated_at      timestamptz not null default now(),
  primary key (team_id, player_id)
);

create index if not exists rosters_player_id_idx on public.rosters (player_id);

alter table public.rosters enable row level security;

drop policy if exists "rosters: via league ownership" on public.rosters;
create policy "rosters: via league ownership"
  on public.rosters
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = rosters.team_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = rosters.team_id and l.user_id = (select auth.uid())
    )
  );

drop trigger if exists rosters_set_updated_at on public.rosters;
create trigger rosters_set_updated_at
  before update on public.rosters
  for each row execute function public.set_updated_at();
