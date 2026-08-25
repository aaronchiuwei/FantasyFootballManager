-- Phase 4: the one-button sync (§9).
--
-- One button, but not one request. The pipeline is eight stages that hand work
-- to each other through Postgres rather than through memory, because a
-- serverless invocation that dies must leave the finished stages committed.
-- Three of the tables here exist only to be that handoff: `market_values` and
-- `yahoo_player_pool` hold what a fetch stage pulled so a later stage can use
-- it without re-fetching, which is what makes an individual stage retryable.

-- ---------------------------------------------------------------------------
-- the durable progress record
-- ---------------------------------------------------------------------------

create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  league_id   uuid not null references public.leagues (id) on delete cascade,
  -- `running` is also the resume state: a retry re-opens the same row rather
  -- than starting a second one, so a league has at most one run in flight.
  status      text not null default 'running'
              check (status in ('running', 'succeeded', 'failed')),
  -- Ordered array of stage states, one per §9 stage. An array rather than an
  -- object because the order *is* the pipeline, and the UI renders it directly.
  stages      jsonb not null default '[]'::jsonb,
  -- What the stages hand each other: the season clock from stage 1, the league
  -- parameters the value sources are keyed on. Kept apart from `stages` so
  -- progress display and pipeline data never have to be untangled.
  context     jsonb not null default '{}'::jsonb,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- The liveness signal. A stage that is killed mid-flight cannot mark itself
  -- failed, so a run whose `updated_at` has gone quiet is how a stall is
  -- detected — by the UI, and by the next run that tries to start.
  updated_at  timestamptz not null default now()
);

create index if not exists sync_runs_league_started_idx
  on public.sync_runs (league_id, started_at desc);

-- Two concurrent syncs of one league would fight over the same rows. Enforced
-- here rather than in the app because a double-clicked button is two requests.
create unique index if not exists sync_runs_one_active_per_league_idx
  on public.sync_runs (league_id) where status = 'running';

alter table public.sync_runs enable row level security;

drop policy if exists "sync_runs: owner" on public.sync_runs;
create policy "sync_runs: owner"
  on public.sync_runs
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists sync_runs_set_updated_at on public.sync_runs;
create trigger sync_runs_set_updated_at
  before update on public.sync_runs
  for each row execute function public.set_updated_at();

-- The progress UI subscribes to this row and nothing else. Realtime applies
-- the policy above to the subscriber's own JWT, so a user only ever streams
-- their own runs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sync_runs'
  ) then
    alter publication supabase_realtime add table public.sync_runs;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- stage 3's output: the market board, persisted
-- ---------------------------------------------------------------------------

-- FantasyCalc prices a league's *parameters*, not a league, so the board is
-- shared by every league that scores the same way — and §12's mitigation for
-- an undocumented API is precisely this: cache the last good values in
-- Postgres so an outage degrades to stale rather than broken.
create table if not exists public.market_values (
  -- `${numQbs}qb-${numTeams}tm-${ppr}ppr`, built by lib/sync/market.ts.
  params_key    text   not null,
  player_id     bigint not null references public.players (id) on delete cascade,
  value         int    not null,
  overall_rank  int,
  position_rank int,
  trend_30d     numeric,
  tier          int,
  fetched_at    timestamptz not null default now(),
  primary key (params_key, player_id)
);

create index if not exists market_values_params_value_idx
  on public.market_values (params_key, value desc);

alter table public.market_values enable row level security;

drop policy if exists "market_values: read all" on public.market_values;
create policy "market_values: read all"
  on public.market_values
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- stage 6's output: everything Yahoo says is in this league
-- ---------------------------------------------------------------------------

-- Rostered players and free agents exactly as Yahoo reported them, before
-- identity resolution has an opinion. Stage 7 reads this instead of calling
-- Yahoo again, which is what lets a failed resolve be retried without paying
-- the free-agent pagination a second time.
create table if not exists public.yahoo_player_pool (
  league_id       uuid not null references public.leagues (id) on delete cascade,
  yahoo_player_id text not null,
  -- null means free agent; otherwise the team whose roster held the player.
  team_key        text,
  payload         jsonb not null,
  fetched_at      timestamptz not null default now(),
  primary key (league_id, yahoo_player_id)
);

alter table public.yahoo_player_pool enable row level security;

drop policy if exists "yahoo_player_pool: via league ownership" on public.yahoo_player_pool;
create policy "yahoo_player_pool: via league ownership"
  on public.yahoo_player_pool
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = yahoo_player_pool.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = yahoo_player_pool.league_id and l.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- matchups (§8, pulled by stage 6)
-- ---------------------------------------------------------------------------

-- Team references are our uuids rather than Yahoo keys so the schedule joins
-- to standings without a translation step. `team_b` is nullable: an odd-sized
-- league gives someone a bye.
create table if not exists public.matchups (
  league_id    uuid not null references public.leagues (id) on delete cascade,
  week         int  not null,
  team_a       uuid not null references public.teams (id) on delete cascade,
  team_b       uuid references public.teams (id) on delete cascade,
  points_a     numeric,
  points_b     numeric,
  projected_a  numeric,
  projected_b  numeric,
  -- Yahoo's own: preevent / midevent / postevent.
  status       text,
  is_playoffs  boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (league_id, week, team_a)
);

create index if not exists matchups_league_week_idx
  on public.matchups (league_id, week);

alter table public.matchups enable row level security;

drop policy if exists "matchups: via league ownership" on public.matchups;
create policy "matchups: via league ownership"
  on public.matchups
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = matchups.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = matchups.league_id and l.user_id = (select auth.uid())
    )
  );

drop trigger if exists matchups_set_updated_at on public.matchups;
create trigger matchups_set_updated_at
  before update on public.matchups
  for each row execute function public.set_updated_at();
