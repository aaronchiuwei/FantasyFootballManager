-- Phase 9: three-team trades (§7 — Requirement 11).
--
-- One table, and it is deliberately the same shape as `trade_suggestions`: a
-- row per suggestion, ranked, upserted under one run stamp by sync stage 8 and
-- pruned afterwards. The differences are the two that matter about a cycle.
--
-- **There is no pair of teams.** `trade_suggestions` has `team_a` and `team_b`
-- because a two-team trade has exactly two sides. A cycle has three
-- participants and no sides at all — A gives to B, B gives to C, C gives to A —
-- so the row carries one team column, `anchor_team`, and it means something
-- narrower: not "a participant" but "the team this search was run for". The
-- other two live in the payload, in ring order.
--
-- **The anchor is part of the search, not a filter on it.** §7 restricts this
-- phase to the top 6 assets a team and ≤ 2 assets a leg with a beam of width
-- 50, and even inside those bounds the exhaustive space is ~4.07M candidate
-- cycles for a 12-team league against Phase 8's 85,536 candidate pairs. Fixing
-- the team the cycle is *for* is what cuts the 440 directed three-cycles in a
-- twelve-team league to the 110 that team can sit in — and it is also the only
-- question anyone asks, which is why it earns a column rather than being
-- recovered from the payload.

create table if not exists public.cycle_suggestions (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,

  -- The team the search ran for, and always the payload's `legs[0]`. The two
  -- other participants are in the payload; they are not indexed, because "show
  -- me the cycles I could be in" is the only question this table answers and a
  -- team is the anchor of its own row.
  anchor_team uuid not null references public.teams (id) on delete cascade,

  -- All three legs frozen whole: who sends what to whom, every player's value
  -- and — §5's first-class field — the provenance of that value, plus each
  -- manager's own fairness verdict and their own lineup delta. Denormalized for
  -- the reason `trade_suggestions.payload` is: values move on every sync, and a
  -- cached recommendation that silently re-derived would be a recommendation
  -- the app never actually made.
  payload jsonb not null,

  -- §9's ranking key, folded over three participants: `min(Δa, Δb, Δc)` in
  -- rest-of-season projected points. Maximizing the smallest gain is what makes
  -- a trade win-win rather than a sale, and with three managers to convince it
  -- is the only key worth ordering on.
  score numeric not null,

  -- The **worst** leg's fairness band, never an average of the three. §7 is
  -- explicit that "each team must independently land inside the fairness band
  -- on its own in-vs-out", and the check constraint is what makes "the search
  -- proposed a cycle one of whose members is being robbed" unrepresentable
  -- rather than merely unlikely. Fairness is not transitive — two legs that are
  -- each 7% apart can close a ring 15% apart — so this column is load-bearing.
  band text not null check (band in ('even', 'slight')),

  -- Position within this anchor's menu, 1 = best. Part of the key so a sync
  -- upserts over the previous run's rows in place.
  rank int not null check (rank >= 1),

  created_at timestamptz not null default now(),

  unique (league_id, anchor_team, rank)
);

create index if not exists cycle_suggestions_league_anchor_idx
  on public.cycle_suggestions (league_id, anchor_team, rank);

comment on table public.cycle_suggestions is
  'Phase 9 (§7 Req. 11): three-team cycles found by a bounded beam search in sync stage 8, one menu per team. Every leg is fair on its own ledger.';

alter table public.cycle_suggestions enable row level security;

-- League ownership, like every other derived table. `anchor_team` is a foreign
-- key into a table holding teams the user does not own, so the league is what
-- the policy checks — and stage 8 writes these under the service role anyway,
-- authorized by the `sync_runs` row an authenticated owner created (§9).
drop policy if exists "cycle_suggestions: via league ownership" on public.cycle_suggestions;
create policy "cycle_suggestions: via league ownership"
  on public.cycle_suggestions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = cycle_suggestions.league_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = cycle_suggestions.league_id and l.user_id = (select auth.uid())
    )
  );
