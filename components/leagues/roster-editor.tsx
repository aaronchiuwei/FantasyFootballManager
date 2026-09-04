"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { PlayerPicker } from "@/components/leagues/player-picker";
import type { PlayerHit, RosterEntry } from "@/lib/leagues/manual";

export type RosterActions = {
  search: (query: string) => Promise<{ hits: PlayerHit[]; error?: string }>;
  setEntry: (playerId: number, slot: string) => Promise<{ error?: string }>;
  remove: (playerId: number) => Promise<{ error?: string }>;
};

/**
 * One team's roster, edited in place.
 *
 * Adding is the same gesture as moving: `setEntry` writes the row whether or
 * not one was there, and takes the player off whichever roster in the league
 * had him. So picking a player who is already owned is not an error to be
 * refused — it is a trade, or a correction, and the picker already said whose
 * he was before the click. That is the whole reason the store enforces one
 * owner per player instead of leaving it to this screen.
 *
 * Optimism is deliberately absent. Every action here is a round trip that
 * revalidates the page, and a roster that briefly shows a player on two teams
 * because the client guessed ahead is exactly the state this feature exists to
 * make impossible. The rows that are in flight spin; nothing lies.
 */
export function RosterEditor({
  teamName,
  entries,
  slots,
  actions,
  disabled,
}: {
  teamName: string;
  entries: RosterEntry[];
  /** The slots this league has, from its own settings. */
  slots: string[];
  actions: RosterActions;
  /** Set when there is no player master to search yet. */
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const run = (
    playerId: number,
    work: () => Promise<{ error?: string }>,
    done?: string,
  ) => {
    setBusy(playerId);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result?.error) toast.error(result.error);
      else if (done) toast.success(done);
    });
  };

  const starters = entries.filter((entry) => entry.isStarter).length;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        label={`Add to ${teamName}`}
        note={
          disabled
            ? "The player list arrives with the first sync. Run one from the league page, then come back."
            : "Picking a player who is already on another roster in this league moves him here."
        }
        inset
      >
        <PlayerPicker
          search={actions.search}
          disabled={disabled}
          busyPlayerId={busy}
          onPick={(hit) =>
            run(
              hit.playerId,
              () => actions.setEntry(hit.playerId, "BN"),
              hit.ownedBy
                ? `${hit.name} moved from ${hit.ownedBy.teamName}.`
                : `${hit.name} added.`,
            )
          }
        />
      </Panel>

      <Panel
        label={`Roster · ${entries.length}`}
        note={
          entries.length === 0
            ? undefined
            : `${starters} in a starting slot, ${entries.length - starters} on the bench or IR.`
        }
      >
        {entries.length === 0 ? (
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Nobody on this roster yet. Search above and the players you pick land
            on the bench, where you can put them in a slot.
          </p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry, index) => (
              <li key={entry.playerId}>
                <div className="flex items-center gap-2.5 py-2.5">
                  <PositionBadge position={entry.position} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-plate text-sm font-semibold text-foreground">
                      {entry.name}
                    </p>
                    <Stencil className="mt-0.5 block">
                      {entry.nflTeam ?? "Free agent"}
                    </Stencil>
                  </div>

                  <InjuryBadge status={entry.injuryStatus} />

                  <Select
                    aria-label={`Slot for ${entry.name}`}
                    value={entry.slot ?? "BN"}
                    disabled={busy === entry.playerId}
                    onChange={(event) =>
                      run(entry.playerId, () =>
                        actions.setEntry(entry.playerId, event.target.value),
                      )
                    }
                    className="h-8 w-28 shrink-0"
                  >
                    {slots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                    {/* A slot the league no longer has, on a player who is
                        still in it. Kept so the control never silently
                        reassigns him just by rendering. */}
                    {entry.slot && !slots.includes(entry.slot) ? (
                      <option value={entry.slot}>{entry.slot}</option>
                    ) : null}
                  </Select>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${entry.name}`}
                    disabled={busy === entry.playerId}
                    onClick={() =>
                      run(
                        entry.playerId,
                        () => actions.remove(entry.playerId),
                        `${entry.name} removed.`,
                      )
                    }
                  >
                    {busy === entry.playerId ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <XIcon aria-hidden />
                    )}
                  </Button>
                </div>
                {index < entries.length - 1 ? <RailLine /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
