-- Phase 1: Yahoo account link + league import.
--
-- Three tables at three different trust levels:
--   yahoo_tokens -> RLS on, NO policy. Only the service role can read it, so a
--                   compromised anon key cannot reach a Yahoo token (§2).
--   leagues      -> user-scoped, `user_id = auth.uid()`.
--   teams        -> league-scoped, ownership proven by a join to leagues.

-- ---------------------------------------------------------------------------
-- yahoo_tokens
-- ---------------------------------------------------------------------------

create table if not exists public.yahoo_tokens (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  access_token_enc  text        not null,
  refresh_token_enc text        not null,
  expires_at        timestamptz not null,
  yahoo_guid        text,
  -- Set when Yahoo rejects the refresh token (revoked, or the user unlinked
  -- the app). The UI prompts for a re-link instead of failing syncs silently.
  needs_reauth      boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.yahoo_tokens is
  'Encrypted Yahoo OAuth tokens. RLS enabled with no policy: service role only.';
comment on column public.yahoo_tokens.access_token_enc is
  'AES-256-GCM ciphertext. The key lives in the app env, never in the database.';

alter table public.yahoo_tokens enable row level security;

-- No policy is created on purpose. Belt and braces: drop the default grants so
-- the table is unreachable even if a policy is ever added by accident.
revoke all on table public.yahoo_tokens from anon, authenticated;

drop trigger if exists yahoo_tokens_set_updated_at on public.yahoo_tokens;
create trigger yahoo_tokens_set_updated_at
  before update on public.yahoo_tokens
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------

create table if not exists public.leagues (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  yahoo_league_key  text not null,
  yahoo_game_key    text,
  name              text not null,
  season            int  not null,
  num_teams         int,
  scoring_type      text,
  -- Scoring is read from Yahoo, never hardcoded (§1.2). These three feed the
  -- FantasyCalc query params directly in Phase 3.
  ppr               numeric not null default 0,
  num_qbs           int     not null default 1,
  roster_slots      jsonb   not null default '[]'::jsonb,
  -- Read so the app can warn rather than silently mis-value a keeper league.
  is_dynasty        boolean not null default false,
  current_week      int,
  start_week        int,
  end_week          int,
  logo_url          text,
  url               text,
  is_finished       boolean not null default false,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Scoped per user, not globally: two managers in the same league must both
  -- be able to import it.
  unique (user_id, yahoo_league_key)
);

alter table public.leagues enable row level security;

drop policy if exists "leagues: owner all" on public.leagues;
create policy "leagues: owner all"
  on public.leagues
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop trigger if exists leagues_set_updated_at on public.leagues;
create trigger leagues_set_updated_at
  before update on public.leagues
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------

create table if not exists public.teams (
  id               uuid primary key default gen_random_uuid(),
  league_id        uuid not null references public.leagues (id) on delete cascade,
  yahoo_team_key   text not null,
  yahoo_team_id    int,
  name             text not null,
  manager_name     text,
  logo_url         text,
  is_users_team    boolean not null default false,
  wins             int,
  losses           int,
  ties             int,
  points_for       numeric,
  points_against   numeric,
  rank             int,
  playoff_seed     int,
  waiver_priority  int,
  faab_balance     int,
  number_of_moves  int,
  number_of_trades int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (league_id, yahoo_team_key)
);

create index if not exists teams_league_id_idx on public.teams (league_id);

alter table public.teams enable row level security;

drop policy if exists "teams: via league ownership" on public.teams;
create policy "teams: via league ownership"
  on public.teams
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = teams.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = teams.league_id and l.user_id = (select auth.uid())
    )
  );

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();
