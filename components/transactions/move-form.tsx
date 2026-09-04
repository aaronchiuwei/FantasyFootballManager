"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRightIcon, Loader2, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { PositionBadge } from "@/components/values/position-badge";
import { PlayerPicker } from "@/components/leagues/player-picker";
import type { PlayerHit } from "@/lib/leagues/manual";
import { validateMove, type MoveItem } from "@/lib/transactions/moves";
import { cn } from "@/lib/utils";

export type MoveTeam = { id: string; name: string };

export type RosterPlayer = {
  playerId: number;
  name: string;
  position: string | null;
};

type Mode = "waiver" | "trade";

const MODES: { key: Mode; label: string; note: string }[] = [
  {
    key: "waiver",
    label: "Add / drop",
    note: "A pickup, a cut, or both at once as a waiver claim.",
  },
  {
    key: "trade",
    label: "Trade",
    note: "Players moving both ways between two teams.",
  },
];

function ChosenPlayer({
  label,
  name,
  position,
  onClear,
}: {
  label: string;
  name: string;
  position: string | null;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] px-3 py-2 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]">
      <Stencil className="shrink-0">{label}</Stencil>
      <PositionBadge position={position} />
      <span className="min-w-0 flex-1 truncate font-plate text-sm font-semibold text-foreground">
        {name}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Clear ${name}`}
        onClick={onClear}
      >
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

/** A roster as a list of checkboxes. Used once per side of a trade. */
function RosterChecklist({
  teamName,
  players,
  selected,
  onToggle,
}: {
  teamName: string;
  players: RosterPlayer[];
  selected: Set<number>;
  onToggle: (playerId: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Stencil>{teamName} sends</Stencil>
      {players.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This roster is empty. Fill it in on the manage screen first.
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] px-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]">
          {players.map((player, index) => (
            <li key={player.playerId}>
              <label className="flex cursor-pointer items-center gap-2.5 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(player.playerId)}
                  onChange={() => onToggle(player.playerId)}
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <PositionBadge position={player.position} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {player.name}
                </span>
              </label>
              {index < players.length - 1 ? <RailLine /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Recording a move.
 *
 * Two modes, because there are two questions. A waiver claim is asked from one
 * team's point of view — who came in, who went out — and a trade is asked from
 * between two teams. Folding them into one generic "players and destinations"
 * form would be shorter to write and slower to use every single time.
 *
 * What they submit is the same thing: a list of legs. The store works out from
 * those legs whether this was an add, a drop, both, or a trade, so the label on
 * a row in the history can never disagree with what the row actually did.
 */
export function MoveForm({
  teams,
  rosters,
  currentWeek,
  search,
  record,
}: {
  teams: MoveTeam[];
  /** Every team's roster, keyed by team id. Small enough to hold here. */
  rosters: Record<string, RosterPlayer[]>;
  currentWeek: number | null;
  search: (query: string) => Promise<{ hits: PlayerHit[]; error?: string }>;
  record: (input: {
    items: MoveItem[];
    week: number | null;
    faabBid: number | null;
    note: string | null;
    occurredAt: string | null;
  }) => Promise<{ error?: string }>;
}) {
  const [mode, setMode] = useState<Mode>("waiver");
  const [pending, startTransition] = useTransition();

  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [incoming, setIncoming] = useState<PlayerHit | null>(null);
  const [outgoing, setOutgoing] = useState<number | null>(null);

  const [teamA, setTeamA] = useState(teams[0]?.id ?? "");
  const [teamB, setTeamB] = useState(teams[1]?.id ?? "");
  const [fromA, setFromA] = useState<Set<number>>(new Set());
  const [fromB, setFromB] = useState<Set<number>>(new Set());

  const [week, setWeek] = useState(currentWeek === null ? "" : String(currentWeek));
  const [faab, setFaab] = useState("");
  const [note, setNote] = useState("");

  const roster = (id: string) => rosters[id] ?? [];
  const nameOf = (id: string) =>
    teams.find((team) => team.id === id)?.name ?? "Team";

  const items = useMemo<MoveItem[]>(() => {
    if (mode === "waiver") {
      const built: MoveItem[] = [];
      if (incoming) {
        built.push({
          playerId: incoming.playerId,
          // A player another team in this league holds is not a free agent, and
          // recording him as one would make the history claim he was on
          // waivers. Where the picker says he came from is where he came from.
          fromTeamId: incoming.ownedBy?.teamId ?? null,
          toTeamId: teamId,
        });
      }
      if (outgoing !== null) {
        built.push({ playerId: outgoing, fromTeamId: teamId, toTeamId: null });
      }
      return built;
    }

    return [
      ...[...fromA].map((playerId) => ({
        playerId,
        fromTeamId: teamA,
        toTeamId: teamB,
      })),
      ...[...fromB].map((playerId) => ({
        playerId,
        fromTeamId: teamB,
        toTeamId: teamA,
      })),
    ];
  }, [mode, incoming, outgoing, teamId, fromA, fromB, teamA, teamB]);

  const problem = items.length === 0 ? null : validateMove(items);

  const toggle = (
    set: Set<number>,
    update: (next: Set<number>) => void,
    playerId: number,
  ) => {
    const next = new Set(set);
    if (next.has(playerId)) next.delete(playerId);
    else next.add(playerId);
    update(next);
  };

  const reset = () => {
    setIncoming(null);
    setOutgoing(null);
    setFromA(new Set());
    setFromB(new Set());
    setFaab("");
    setNote("");
  };

  const submit = () => {
    const blocker = validateMove(items);
    if (blocker) {
      toast.error(blocker);
      return;
    }

    startTransition(async () => {
      const result = await record({
        items,
        week: week.trim() === "" ? null : Number(week),
        faabBid: mode === "waiver" && faab.trim() !== "" ? Number(faab) : null,
        note: note.trim() || null,
        occurredAt: null,
      });

      if (result?.error) toast.error(result.error);
      else {
        toast.success("Move recorded and the rosters updated.");
        reset();
      }
    });
  };

  const modeNote = MODES.find((entry) => entry.key === mode)?.note;

  return (
    <Panel
      label="Record a move"
      note={modeNote}
      action={
        <div className="flex items-center gap-1.5">
          {MODES.map((entry) => (
            <Button
              key={entry.key}
              type="button"
              size="sm"
              variant={mode === entry.key ? "secondary" : "ghost"}
              aria-pressed={mode === entry.key}
              onClick={() => setMode(entry.key)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {mode === "waiver" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="move-team">Team</Label>
              <Select
                id="move-team"
                value={teamId}
                onChange={(event) => {
                  setTeamId(event.target.value);
                  setOutgoing(null);
                }}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="move-in">Player added</Label>
                {incoming ? (
                  <ChosenPlayer
                    label="In"
                    name={incoming.name}
                    position={incoming.position}
                    onClear={() => setIncoming(null)}
                  />
                ) : (
                  <PlayerPicker
                    search={search}
                    onPick={setIncoming}
                    placeholder="Search for the player picked up…"
                  />
                )}
                {incoming?.ownedBy ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {incoming.name} is on {incoming.ownedBy.teamName}, so this
                    will be recorded as a move between those teams rather than a
                    waiver pickup.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="move-out">Player dropped</Label>
                <Select
                  id="move-out"
                  value={outgoing === null ? "" : String(outgoing)}
                  onChange={(event) =>
                    setOutgoing(
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                >
                  <option value="">Nobody</option>
                  {roster(teamId).map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {player.position ? `${player.position} · ` : ""}
                      {player.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
              <div className="flex flex-col gap-2">
                <Label htmlFor="trade-a">First team</Label>
                <Select
                  id="trade-a"
                  value={teamA}
                  onChange={(event) => {
                    setTeamA(event.target.value);
                    setFromA(new Set());
                  }}
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>

              <ArrowRightIcon
                aria-hidden
                className="hidden size-4 self-center text-chalk-dim sm:block"
              />

              <div className="flex flex-col gap-2">
                <Label htmlFor="trade-b">Second team</Label>
                <Select
                  id="trade-b"
                  value={teamB}
                  onChange={(event) => {
                    setTeamB(event.target.value);
                    setFromB(new Set());
                  }}
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <RosterChecklist
                teamName={nameOf(teamA)}
                players={roster(teamA)}
                selected={fromA}
                onToggle={(playerId) => toggle(fromA, setFromA, playerId)}
              />
              <RosterChecklist
                teamName={nameOf(teamB)}
                players={roster(teamB)}
                selected={fromB}
                onToggle={(playerId) => toggle(fromB, setFromB, playerId)}
              />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-week">Week</Label>
            <Input
              id="move-week"
              value={week}
              onChange={(event) => setWeek(event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
            />
          </div>

          {mode === "waiver" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="move-faab">FAAB bid</Label>
              <Input
                id="move-faab"
                value={faab}
                onChange={(event) => setFaab(event.target.value)}
                inputMode="numeric"
                placeholder="Optional"
              />
            </div>
          ) : null}

          <div
            className={cn(
              "flex flex-col gap-2",
              mode === "waiver" ? "sm:col-span-1" : "sm:col-span-2",
            )}
          >
            <Label htmlFor="move-note">Note</Label>
            <Textarea
              id="move-note"
              rows={1}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        {problem ? <p className="text-sm text-destructive">{problem}</p> : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={submit}
            disabled={pending || items.length === 0 || problem !== null}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Recording
              </>
            ) : (
              "Record move"
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            The rosters are updated as well as the log.
          </p>
        </div>
      </div>
    </Panel>
  );
}
