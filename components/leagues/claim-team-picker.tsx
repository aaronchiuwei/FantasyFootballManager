"use client";

import { useState, useTransition } from "react";
import { Loader2, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { claimEspnTeamAction } from "@/app/(app)/leagues/[id]/actions";

export type ClaimableTeam = { id: string; name: string; managerName: string | null };

/**
 * "Which of these is yours?", for an ESPN league read without cookies.
 *
 * A list of buttons rather than a select plus a submit: there are ten or
 * twelve of them, the choice is made once, and one click is the whole
 * interaction.
 */
export function ClaimTeamPicker({
  leagueId,
  teams,
}: {
  leagueId: string;
  teams: ClaimableTeam[];
}) {
  const [pending, startTransition] = useTransition();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {teams.map((team) => (
          <Button
            key={team.id}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setClaiming(team.id);
              setError(null);
              startTransition(async () => {
                const result = await claimEspnTeamAction(leagueId, team.id);
                if (result.error) setError(result.error);
              });
            }}
          >
            {pending && claiming === team.id ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {team.name}
            {team.managerName ? (
              <span className="text-muted-foreground">· {team.managerName}</span>
            ) : null}
          </Button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm leading-relaxed text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
