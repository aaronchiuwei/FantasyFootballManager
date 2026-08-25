-- Phase 6: the trade analyzer (§6 — Requirements 3, 5 and 6).
--
-- Two tables, both from §8's "user artifacts" block: the per-league tuning
-- knobs the bonus math reads, and the trades a user chose to keep.
--
-- Nothing here caches a verdict. §2 makes the analyzer "pure and fast enough to
-- run on every keystroke against cached values", so a verdict is a function of
-- `player_values` and the three knobs below — recomputed in the browser, never
-- stored as truth. What a saved trade stores is a *snapshot*: the values as
-- they stood when the judgement was made, which is a different and durable
-- claim (values move on every sync).

-- ---------------------------------------------------------------------------
-- the tunables (§6)
-- ---------------------------------------------------------------------------

create table if not exists public.league_settings (
  league_id uuid primary key references public.leagues (id) on delete cascade,

  -- §6's proportional best-player bonus: `alpha × value(best asset on a side)`,
  -- applied per side so two comparable studs largely cancel.
  --
  -- §8's schema sketch wrote 0.15 here. §6 then measured the two markets
  -- against each other and concluded otherwise: FantasyCalc is steeply
  -- top-heavy — its top 100 hold 92.3% of all league value — so the superstar
  -- premium is *already in the curve*, and charging it again at 0.15 makes the
  -- analyzer approve every 2-for-1. The default is the number §6 landed on
  -- after that measurement, and it calls this "the single most important tuning
  -- decision in the app".
  alpha  numeric not null default 0.08 check (alpha  between 0 and 1),

  -- The counterweight: `beta × (n − 1) × median(side)`. Roster spots are
  -- finite, and without this the calculator happily approves 4-for-1 packages
  -- that no real manager would accept.
  beta   numeric not null default 0.03 check (beta   between 0 and 1),

  -- The extra for holding the single best player in the *whole* deal.
  gamma  numeric not null default 0.05 check (gamma  between 0 and 1),

  -- §7's waiver need weight. It lives here because §8 keys all four league
  -- tunables to one row; Phase 6 neither reads nor writes it. Left with its
  -- default so Phase 7 finds a row already shaped for it.
  lambda numeric not null default 0.5  check (lambda between 0 and 5),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.league_settings is
  'Per-league tunables. alpha/beta/gamma feed the §6 trade math; lambda is reserved for §7 waiver scoring.';

alter table public.league_settings enable row level security;

drop policy if exists "league_settings: via league ownership" on public.league_settings;
create policy "league_settings: via league ownership"
  on public.league_settings
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_settings.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_settings.league_id and l.user_id = (select auth.uid())
    )
  );

drop trigger if exists league_settings_set_updated_at on public.league_settings;
create trigger league_settings_set_updated_at
  before update on public.league_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- saved trades (§8)
-- ---------------------------------------------------------------------------

create table if not exists public.saved_trades (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  league_id  uuid not null references public.leagues (id) on delete cascade,

  -- The whole analysed trade as it stood: both sides, every player's value and
  -- its provenance, the knobs in force, and the resulting margin. Denormalized
  -- on purpose — a saved trade is a record of a judgement at a moment, and
  -- re-deriving it from today's `player_values` would silently rewrite
  -- yesterday's verdict. Reloading a saved trade into the analyzer re-prices it
  -- against current values; the row itself does not move.
  payload    jsonb not null,

  -- §6's four fairness bands, hoisted out of the payload so the list can be
  -- filtered and counted without opening it.
  verdict    text not null check (verdict in ('even', 'slight', 'clear', 'lopsided')),
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists saved_trades_league_created_idx
  on public.saved_trades (league_id, created_at desc);

comment on table public.saved_trades is
  'Trades a user kept, with the values and tunables that produced the verdict frozen into payload.';

alter table public.saved_trades enable row level security;

-- Owner-scoped, and the league has to be theirs too: `league_id` is a foreign
-- key to a table this user may not own, so without the second clause a user
-- could file a trade against someone else's league.
drop policy if exists "saved_trades: owner" on public.saved_trades;
create policy "saved_trades: owner"
  on public.saved_trades
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.leagues l
      where l.id = saved_trades.league_id and l.user_id = (select auth.uid())
    )
  );
