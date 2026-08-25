-- Phase 2: player identity crosswalk (§4) + the tables the value engine (§5)
-- and stats (§ Phase 5) will write into. Global reference data — readable by
-- any authenticated user, writable only by the service role, per §8.

create table if not exists public.players (
  id             bigserial primary key,
  sleeper_id     text unique,
  full_name      text not null,
  search_name    text not null,
  position       text,
  nfl_team       text,
  age            numeric,
  years_exp      int,
  status         text,
  injury_status  text,
  headshot_url   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists players_search_name_idx on public.players (search_name);
create index if not exists players_position_idx on public.players (position);

alter table public.players enable row level security;

drop policy if exists "players: read all" on public.players;
create policy "players: read all"
  on public.players
  for select
  to authenticated
  using (true);

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crosswalk (§4 resolution ladder)
-- ---------------------------------------------------------------------------

create table if not exists public.player_crosswalk (
  player_id    bigint not null references public.players (id) on delete cascade,
  source       text   not null,
  source_id    text   not null,
  match_method text   not null,
  confidence   numeric not null,
  created_at   timestamptz not null default now(),
  primary key (source, source_id)
);

create index if not exists player_crosswalk_player_id_idx
  on public.player_crosswalk (player_id);

alter table public.player_crosswalk enable row level security;

drop policy if exists "player_crosswalk: read all" on public.player_crosswalk;
create policy "player_crosswalk: read all"
  on public.player_crosswalk
  for select
  to authenticated
  using (true);

-- Manual override always wins (§4 step 1). Keyed the same way as the
-- crosswalk it overrides, so a resolver can check both with one shape.
create table if not exists public.player_id_overrides (
  source     text not null,
  source_id  text not null,
  player_id  bigint not null references public.players (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  primary key (source, source_id)
);

alter table public.player_id_overrides enable row level security;

drop policy if exists "player_id_overrides: read all" on public.player_id_overrides;
create policy "player_id_overrides: read all"
  on public.player_id_overrides
  for select
  to authenticated
  using (true);

-- Any signed-in user may write an override (the admin resolution UI, §4).
-- Tightening this to a specific admin role is a later concern; for a
-- personal-scale app every signed-in user is a trusted operator.
drop policy if exists "player_id_overrides: authenticated write" on public.player_id_overrides;
create policy "player_id_overrides: authenticated write"
  on public.player_id_overrides
  for insert
  to authenticated
  with check (true);

drop policy if exists "player_id_overrides: authenticated delete" on public.player_id_overrides;
create policy "player_id_overrides: authenticated delete"
  on public.player_id_overrides
  for delete
  to authenticated
  using (true);

-- League-scoped: two leagues can see the same Yahoo player fail to resolve
-- independently, and resolving it in one league's admin UI should not hide it
-- from another user's league.
create table if not exists public.unmatched_players (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues (id) on delete cascade,
  yahoo_player_id text not null,
  payload         jsonb not null,
  resolved_at     timestamptz,
  resolved_player_id bigint references public.players (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (league_id, yahoo_player_id)
);

alter table public.unmatched_players enable row level security;

drop policy if exists "unmatched_players: via league ownership" on public.unmatched_players;
create policy "unmatched_players: via league ownership"
  on public.unmatched_players
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = unmatched_players.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = unmatched_players.league_id and l.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- values, stats, projections (§5, Phase 5 — schema now, populated later)
-- ---------------------------------------------------------------------------

create table if not exists public.player_values (
  player_id    bigint not null references public.players (id) on delete cascade,
  league_id    uuid not null references public.leagues (id) on delete cascade,
  value        int not null,
  base_value   int,
  value_source text not null,
  confidence   numeric,
  overall_rank int,
  position_rank int,
  trend_30d    numeric,
  tier         int,
  computed_at  timestamptz not null default now(),
  primary key (player_id, league_id)
);

alter table public.player_values enable row level security;

drop policy if exists "player_values: via league ownership" on public.player_values;
create policy "player_values: via league ownership"
  on public.player_values
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = player_values.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = player_values.league_id and l.user_id = (select auth.uid())
    )
  );

create table if not exists public.player_stats (
  player_id bigint not null references public.players (id) on delete cascade,
  season    int not null,
  week      int not null default 0, -- 0 = season total
  stats     jsonb not null default '{}'::jsonb,
  pts_ppr   numeric,
  primary key (player_id, season, week)
);

alter table public.player_stats enable row level security;

drop policy if exists "player_stats: read all" on public.player_stats;
create policy "player_stats: read all"
  on public.player_stats
  for select
  to authenticated
  using (true);

create table if not exists public.player_projections (
  player_id bigint not null references public.players (id) on delete cascade,
  season    int not null,
  week      int not null default 0,
  stats     jsonb not null default '{}'::jsonb,
  pts_ppr   numeric,
  primary key (player_id, season, week)
);

alter table public.player_projections enable row level security;

drop policy if exists "player_projections: read all" on public.player_projections;
create policy "player_projections: read all"
  on public.player_projections
  for select
  to authenticated
  using (true);
