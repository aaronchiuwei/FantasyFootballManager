-- Manual leagues: everything Yahoo would have told us, typed in by hand.
--
-- Yahoo's API is the app's only way in, and getting a key for it is a request
-- to a third party that can sit unanswered for weeks. Every screen downstream
-- of the import -- values, needs, the trade analyzer, the win-win search --
-- reads Postgres, not Yahoo. So the seam this fills is the *entry*, not the
-- model: a league whose rows were typed rather than fetched is the same league
-- to every stage after `resolve`.
--
-- Nothing here removes or weakens the Yahoo path. `leagues.source` is the one
-- flag that tells the two apart, and it defaults to 'yahoo' so every row that
-- already exists keeps meaning exactly what it meant.

-- ---------------------------------------------------------------------------
-- where a league came from
-- ---------------------------------------------------------------------------

alter table public.leagues
  add column if not exists source text not null default 'yahoo';

alter table public.leagues
  drop constraint if exists leagues_source_check;

alter table public.leagues
  add constraint leagues_source_check check (source in ('yahoo', 'manual'));

comment on column public.leagues.source is
  'yahoo = imported over the API; manual = entered by hand. Sync stages 6 and 7 are skipped for manual.';

-- `yahoo_league_key` stays `not null` and stays uniquely indexed with
-- `user_id`, because `importLeague` upserts on that pair and PostgREST cannot
-- express `on conflict ... where` against a partial index. A manual league
-- therefore carries a synthetic key of the form `manual:<uuid>`: unique by
-- construction, obviously not a Yahoo key to anyone reading a row, and it
-- keeps every existing query -- including the free-agent view below -- working
-- without a nullable join column.
comment on column public.leagues.yahoo_league_key is
  'Yahoo''s own key, or `manual:<uuid>` when source = ''manual''.';

comment on column public.teams.yahoo_team_key is
  'Yahoo''s own key, or `manual:<uuid>` for a team on a manually entered league.';

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

-- The ledger behind a manual league's rosters. A Yahoo league gets its moves
-- for free -- stage 6 re-reads every roster whole on every sync, so the truth
-- is whatever Yahoo last said. A hand-kept league has no such source, and
-- "edit the roster until it looks right" loses the one thing a manager
-- actually wants back later: what changed, when, and against whom.
--
-- So a move is recorded here *and* applied to `rosters` in the same server
-- action. `rosters` stays the single answer to "who has him now"; this table
-- is the history that produced it.
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues (id) on delete cascade,
  -- add / drop / add_drop (a waiver claim that cut someone) / trade.
  kind        text not null,
  occurred_at timestamptz not null default now(),
  -- The league week, when the manager knows it. Free text about the move goes
  -- in `note`; neither is ever read by the value engine.
  week        int,
  faab_bid    int,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.transactions
  drop constraint if exists transactions_kind_check;

alter table public.transactions
  add constraint transactions_kind_check
  check (kind in ('add', 'drop', 'add_drop', 'trade'));

create index if not exists transactions_league_time_idx
  on public.transactions (league_id, occurred_at desc);

-- One player moving one way. A trade is several of these under one
-- transaction; an add is a single row with a null `from_team_id`.
--
-- Null on either side means "outside the league": null `from_team_id` is the
-- free-agent pool or waivers, null `to_team_id` is a player cut back to it. A
-- row with both null would say nothing happened, so the check forbids it.
create table if not exists public.transaction_items (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid   not null references public.transactions (id) on delete cascade,
  player_id      bigint not null references public.players (id) on delete cascade,
  from_team_id   uuid references public.teams (id) on delete cascade,
  to_team_id     uuid references public.teams (id) on delete cascade,
  created_at     timestamptz not null default now()
);

alter table public.transaction_items
  drop constraint if exists transaction_items_direction_check;

alter table public.transaction_items
  add constraint transaction_items_direction_check
  check (from_team_id is not null or to_team_id is not null);

create index if not exists transaction_items_transaction_idx
  on public.transaction_items (transaction_id);

create index if not exists transaction_items_player_idx
  on public.transaction_items (player_id);

alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;

drop policy if exists "transactions: via league ownership" on public.transactions;
create policy "transactions: via league ownership"
  on public.transactions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = transactions.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = transactions.league_id and l.user_id = (select auth.uid())
    )
  );

drop policy if exists "transaction_items: via league ownership" on public.transaction_items;
create policy "transaction_items: via league ownership"
  on public.transaction_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.transactions tx
      join public.leagues l on l.id = tx.league_id
      where tx.id = transaction_items.transaction_id
        and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.transactions tx
      join public.leagues l on l.id = tx.league_id
      where tx.id = transaction_items.transaction_id
        and l.user_id = (select auth.uid())
    )
  );

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- the waiver wire's read model, for both kinds of league
-- ---------------------------------------------------------------------------

-- Restated whole, because a view cannot gain a branch any other way. The Yahoo
-- half is unchanged apart from the `source` guard; the manual half is new.
--
-- The two halves answer the same question from different evidence, and the
-- difference is worth naming. For a Yahoo league the pool is Yahoo's own
-- available list, because "a recommendation you cannot act on is not a
-- recommendation" -- Yahoo knows which players its league actually offers. A
-- manual league has no such list and never will, so the only honest pool is
-- "priced, and on nobody's roster here". That is a wider net than Yahoo's, and
-- it is wider in the harmless direction: the waiver board orders on
-- rest-of-season projection and cuts at 250, so the extra names sit far below
-- the fold rather than crowding the top of it.
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
join public.leagues l on l.id = pool.league_id and l.source = 'yahoo'
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
  -- Yahoo's "why" for an injury has no manual equivalent. The status badge
  -- still comes off the Sleeper master; only the body part is missing.
  null::text as injury_note,
  p.headshot_url,
  pp.pts_ppr as projected_pts_ppr,
  -- There was no fetch. The valuation run is the freshest thing this row can
  -- honestly claim, and it is what the screen's "as of" line reads.
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
  'Available players for a league: Yahoo''s own list where there is one, everything priced and unrostered on a manual league. security_invoker: the underlying RLS still applies.';
