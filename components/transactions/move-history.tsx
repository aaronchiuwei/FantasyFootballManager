"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRightIcon, Loader2, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { PositionBadge } from "@/components/values/position-badge";
import { MOVE_LABELS } from "@/lib/transactions/moves";
import type { MoveRecord } from "@/lib/transactions/store";

function when(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Where a leg came from and went, in the words a manager would use. */
function legs(from: string | null, to: string | null): [string, string] {
  return [from ?? "Free agents", to ?? "Free agents"];
}

/**
 * What happened, in reverse order.
 *
 * Deleting a row removes the record and nothing else — the roster it produced
 * stays as it is. That is the honest behaviour rather than the convenient one:
 * a move from three weeks ago has been built on since, and quietly reversing it
 * would undo every later move that assumed it. The button says so, and the
 * roster is corrected on the manage screen.
 */
export function MoveHistory({
  moves,
  remove,
}: {
  moves: MoveRecord[];
  remove: (transactionId: string) => Promise<{ error?: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (moves.length === 0) {
    return (
      <Panel label="History">
        <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          No moves recorded yet. Everything logged above appears here, newest
          first, and the rosters it produced are the ones the rest of the league
          is priced from.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      label={`History · ${moves.length}`}
      note="Removing an entry deletes the record only. The rosters stay as the move left them."
    >
      <ul className="flex flex-col">
        {moves.map((move, index) => (
          <li key={move.id}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{MOVE_LABELS[move.kind]}</Badge>
                  <Stencil>{when(move.occurredAt)}</Stencil>
                  {move.week ? <Stencil>Week {move.week}</Stencil> : null}
                  {move.faabBid !== null ? (
                    <Stencil tone="grease">${move.faabBid}</Stencil>
                  ) : null}
                </div>

                <ul className="mt-2 flex flex-col gap-1.5">
                  {move.entries.map((entry) => {
                    const [from, to] = legs(entry.fromTeam, entry.toTeam);

                    return (
                      <li
                        key={`${move.id}:${entry.playerId}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1"
                      >
                        <PositionBadge position={entry.position} />
                        <span className="font-plate text-sm font-semibold text-foreground">
                          {entry.playerName}
                        </span>
                        <span
                          data-numeric
                          className="stencil flex items-center gap-1.5 text-chalk-dim"
                        >
                          {from}
                          <ArrowRightIcon aria-hidden className="size-3" />
                          {to}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {move.note ? (
                  <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                    {move.note}
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Remove this record"
                disabled={busy === move.id}
                onClick={() => {
                  setBusy(move.id);
                  startTransition(async () => {
                    const result = await remove(move.id);
                    setBusy(null);
                    if (result?.error) toast.error(result.error);
                    else toast.success("Record removed. Rosters are unchanged.");
                  });
                }}
              >
                {busy === move.id ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Trash2Icon aria-hidden />
                )}
              </Button>
            </div>
            {index < moves.length - 1 ? <RailLine /> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
