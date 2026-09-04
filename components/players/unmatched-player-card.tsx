"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolveUnmatchedAction } from "@/app/(app)/leagues/[id]/identity/actions";
import type {
  CrosswalkCandidate,
  UnmatchedPayload,
} from "@/lib/crosswalk/resolve";
import { providerLabels } from "@/lib/leagues/provider";

export type UnmatchedView = {
  id: string;
  /**
   * The provider's own id for this player.
   *
   * Named for Yahoo because the column is — every provider id lives under the
   * `yahoo` crosswalk source, ESPN's included. What it is *called on screen*
   * comes from the league, not from this name.
   */
  yahooPlayerId: string;
  payload: UnmatchedPayload;
  suggestions: CrosswalkCandidate[];
};

function describe(position: string | null, team: string | null) {
  return [position ?? "--", team ?? "FA"].join(" · ");
}

export function UnmatchedPlayerCard({
  leagueId,
  entry,
  source,
}: {
  leagueId: string;
  entry: UnmatchedView;
  /** `leagues.source`, so an ESPN id is not labelled as Yahoo's. */
  source: string;
}) {
  const [pending, startTransition] = useTransition();

  function resolve(playerId: number) {
    startTransition(async () => {
      const { error, name } = await resolveUnmatchedAction(
        leagueId,
        entry.id,
        playerId,
      );

      if (error) toast.error(error);
      else toast.success(`${name} resolved.`);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="font-medium">{entry.payload.name}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {describe(entry.payload.position, entry.payload.nflTeam)} ·{" "}
              {providerLabels(source).idPrefix} #{entry.yahooPlayerId}
            </p>
          </div>

          <Badge variant={entry.payload.teamKey ? "destructive" : "secondary"}>
            {entry.payload.teamKey ? "Rostered" : "Free agent"}
          </Badge>
        </div>

        {entry.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No candidate in the player master looks close. This is usually a
            player Sleeper has not published yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {entry.suggestions.map((candidate) => (
              <li
                key={candidate.playerId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_42%,transparent)] shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{candidate.fullName}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {describe(candidate.position, candidate.nflTeam)}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => resolve(candidate.playerId)}
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-4" aria-hidden />
                  )}
                  Same player
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
