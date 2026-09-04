-- A league you named yourself.
--
-- `leagues.name` is written by `saveLeague` on every sync, because for an
-- imported league the provider is the authority on what it is called. That
-- makes renaming one a change that survives until the next sync and then
-- silently reverts, which is worse than not offering it at all.
--
-- This flag is the exception, and it is a flag rather than a second name
-- column on purpose: every read site in the app already selects `name`, and
-- a `display_name` to coalesce with would mean touching all of them to fix a
-- problem that only exists at write time. One boolean, checked in the one
-- function that writes the column.
--
-- Manual leagues do not need it — nothing overwrites their name — but they
-- carry it too, so "did a human choose this name" has one answer everywhere.

alter table public.leagues
  add column if not exists name_overridden boolean not null default false;

comment on column public.leagues.name_overridden is
  'True once the user renamed the league. `saveLeague` then leaves `name` alone on every later sync.';

-- What the provider last called it, kept whether or not the user has renamed
-- it. Two jobs: it is what a reset restores, and it is what the reset control
-- shows so the choice is legible before it is made.
--
-- Written on every sync even while a rename is in force, so a league renamed
-- on Yahoo *and* renamed here still offers the current provider name rather
-- than the one it had when the override was set.
--
-- Null for a manual league, which has no provider to disagree with. That null
-- is what the UI gates on, so no reset control appears where there is nothing
-- to reset to.
alter table public.leagues
  add column if not exists provider_name text;

comment on column public.leagues.provider_name is
  'The name the provider last reported. Null for manual leagues. Restored by a name reset.';

-- Backfill, and it is exact rather than a guess. At the moment this migration
-- runs the override flag does not yet exist, so no league can have been
-- renamed — which means `name` is necessarily still whatever the provider
-- said. Copying it across makes a reset available immediately instead of only
-- after each league's next sync.
--
-- Manual leagues are excluded on purpose: their name has only ever been the
-- one someone typed, and giving them a provider name would offer a reset to a
-- name no provider ever supplied.
update public.leagues
set provider_name = name
where provider_name is null
  and source <> 'manual';
