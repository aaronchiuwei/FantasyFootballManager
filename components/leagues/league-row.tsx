"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  Loader2,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteLeagueAction,
  renameLeagueAction,
  resetLeagueNameAction,
} from "@/app/(app)/leagues/actions";

export type ManagedLeague = {
  id: string;
  name: string;
  season: number;
  detail: string;
  /** True once someone renamed it, so sync no longer touches the name. */
  nameOverridden: boolean;
  /** What the provider calls it. Null on a manual league. */
  providerName: string | null;
};

/**
 * One league on the list, with the two things you can do to the league itself.
 *
 * Rename and delete live here rather than inside the league because they are
 * about the board rather than about anything on it — and because a delete has
 * to leave you somewhere, which a list already is and a league page is not.
 *
 * Deleting asks twice, in place, rather than through a dialog. There is no
 * undo: every child table cascades, so the values, needs, suggestions, move
 * history and — for a hand-kept league — the rosters someone typed all go with
 * it. A second click on a button that has changed its own label is a cheap way
 * to make sure the first one was meant.
 */
export function LeagueRow({ league }: { league: ManagedLeague }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(league.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const next = name.trim();
    if (next === league.name) {
      setRenaming(false);
      return;
    }

    startTransition(async () => {
      const result = await renameLeagueAction(league.id, next);
      if (result?.error) toast.error(result.error);
      else {
        toast.success("League renamed.");
        setRenaming(false);
      }
    });
  };

  const reset = () => {
    startTransition(async () => {
      const result = await resetLeagueNameAction(league.id);
      if (result?.error) toast.error(result.error);
      else {
        toast.success(`Renamed back to ${league.providerName}.`);
        setRenaming(false);
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteLeagueAction(league.id);
      if (result?.error) {
        toast.error(result.error);
        setConfirming(false);
      } else {
        toast.success(`${league.name} deleted.`);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
                if (event.key === "Escape") {
                  setName(league.name);
                  setRenaming(false);
                }
              }}
              aria-label={`Name for ${league.name}`}
              maxLength={120}
              autoFocus
              className="h-8 max-w-[22rem]"
            />
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel rename"
              onClick={() => {
                setName(league.name);
                setRenaming(false);
              }}
            >
              <XIcon aria-hidden />
            </Button>

            {/* Only offered when there is somewhere to go back to: a provider
                name exists, a human has overridden it, and the two differ. A
                manual league has no provider name and never sees this. */}
            {league.nameOverridden &&
            league.providerName &&
            league.providerName !== league.name ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={reset}
                title={`Go back to the name the provider uses: ${league.providerName}`}
              >
                <RotateCcwIcon aria-hidden />
                <span className="max-w-[16ch] truncate">
                  Use “{league.providerName}”
                </span>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="truncate font-plate text-base font-semibold text-foreground">
              {league.name}
            </p>
            <Badge variant="outline">{league.season}</Badge>
          </div>
        )}

        <p data-numeric className="stencil mt-1 tabular-nums text-chalk-dim">
          {confirming
            ? "Deleting takes its teams, rosters, values and history with it. This cannot be undone."
            : league.detail}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {confirming ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={remove}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Delete for good
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Rename ${league.name}`}
              onClick={() => setRenaming((open) => !open)}
            >
              <PencilIcon aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${league.name}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon aria-hidden />
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/leagues/${league.id}`}>
                Open
                <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
