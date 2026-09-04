"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, Loader2, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import type { ActionResult, TeamFields } from "@/app/(app)/leagues/[id]/manage/actions";

export type EditableTeam = {
  id: string;
  name: string;
  managerName: string | null;
  isUsersTeam: boolean;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  pointsFor: number | null;
  faabBalance: number | null;
  rosterCount: number;
};

export type TeamActions = {
  add: (name: string, managerName: string) => Promise<ActionResult>;
  update: (teamId: string, fields: TeamFields) => Promise<ActionResult>;
  setUsers: (teamId: string) => Promise<ActionResult>;
  remove: (teamId: string) => Promise<ActionResult>;
};

const blank = (team: EditableTeam): TeamFields => ({
  name: team.name,
  managerName: team.managerName ?? "",
  wins: team.wins === null ? "" : String(team.wins),
  losses: team.losses === null ? "" : String(team.losses),
  ties: team.ties === null ? "" : String(team.ties),
  pointsFor: team.pointsFor === null ? "" : String(team.pointsFor),
  faabBalance: team.faabBalance === null ? "" : String(team.faabBalance),
});

function record(team: EditableTeam): string {
  if (team.wins === null && team.losses === null) return "No record recorded";
  const parts = [`${team.wins ?? 0}-${team.losses ?? 0}`];
  if (team.ties) parts[0] += `-${team.ties}`;
  if (team.pointsFor !== null) parts.push(`${team.pointsFor} PF`);
  return parts.join(" · ");
}

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  const id = `${label.replace(/\s+/g, "-").toLowerCase()}-field`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode="decimal"
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="h-8"
      />
    </div>
  );
}

/**
 * The standings, entered rather than read.
 *
 * A record is optional everywhere it appears, which is why the fields here can
 * all be left blank. Nothing in the value engine or the trade math reads a
 * team's record — §1.5 keeps evaluation value-first — so an empty record costs
 * a line on the team card and nothing else. Asking for it as though it were
 * required would be asking for busywork.
 *
 * The one field that is not cosmetic is which team is yours: every "my team"
 * filter, the trade analyzer's default side and the waiver board's default
 * needs vector all read it, so it is a single exclusive choice made here.
 */
export function TeamsEditor({
  teams,
  actions,
  selectedTeamId,
  onSelect,
}: {
  teams: EditableTeam[];
  actions: TeamActions;
  /** The team whose roster is open below, so the list can mark it. */
  selectedTeamId: string | null;
  onSelect: (teamId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [fields, setFields] = useState<TeamFields | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newManager, setNewManager] = useState("");
  const [, startTransition] = useTransition();

  const run = (
    key: string,
    work: () => Promise<ActionResult>,
    after?: () => void,
  ) => {
    setBusy(key);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result?.error) toast.error(result.error);
      else after?.();
    });
  };

  const patch = (part: Partial<TeamFields>) =>
    setFields((current) => (current ? { ...current, ...part } : current));

  return (
    <Panel
      label={`Teams · ${teams.length}`}
      note="Pick one to edit its roster below. Records are optional — nothing prices off them."
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAdding((open) => !open)}
        >
          <PlusIcon aria-hidden />
          Add team
        </Button>
      }
    >
      {adding ? (
        <div className="mb-3.5 flex flex-wrap items-end gap-2 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] p-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="new-team-name">Team name</Label>
            <Input
              id="new-team-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              className="h-8"
            />
          </div>
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="new-team-manager">Manager</Label>
            <Input
              id="new-team-manager"
              value={newManager}
              onChange={(event) => setNewManager(event.target.value)}
              className="h-8"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={busy === "add"}
            onClick={() =>
              run("add", () => actions.add(newName, newManager), () => {
                setNewName("");
                setNewManager("");
                setAdding(false);
              })
            }
          >
            {busy === "add" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            Add
          </Button>
        </div>
      ) : null}

      <ul className="flex flex-col">
        {teams.map((team, index) => {
          const open = editing === team.id;

          return (
            <li key={team.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <button
                  type="button"
                  onClick={() => onSelect(team.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        selectedTeamId === team.id
                          ? "truncate font-plate text-base font-semibold text-grease"
                          : "truncate font-plate text-base font-semibold text-foreground"
                      }
                    >
                      {team.name}
                    </span>
                    {team.isUsersTeam ? <Badge>My team</Badge> : null}
                    <Badge variant="outline">{team.rosterCount} players</Badge>
                  </div>
                  <Stencil className="mt-1 block">
                    {team.managerName ? `${team.managerName} · ` : ""}
                    {record(team)}
                  </Stencil>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  {team.isUsersTeam ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy === `mine:${team.id}`}
                      onClick={() =>
                        run(`mine:${team.id}`, () => actions.setUsers(team.id))
                      }
                    >
                      {busy === `mine:${team.id}` ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <CheckIcon aria-hidden />
                      )}
                      Mine
                    </Button>
                  )}

                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${team.name}`}
                    aria-expanded={open}
                    onClick={() => {
                      setEditing(open ? null : team.id);
                      setFields(open ? null : blank(team));
                    }}
                  >
                    <PencilIcon aria-hidden />
                  </Button>

                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${team.name}`}
                    disabled={busy === `del:${team.id}` || teams.length <= 2}
                    title={
                      teams.length <= 2
                        ? "A league needs at least two teams."
                        : undefined
                    }
                    onClick={() =>
                      run(`del:${team.id}`, () => actions.remove(team.id))
                    }
                  >
                    {busy === `del:${team.id}` ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2Icon aria-hidden />
                    )}
                  </Button>
                </div>
              </div>

              {open && fields ? (
                <div className="mb-3 grid gap-3 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] p-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)] sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor={`name-${team.id}`}>Team name</Label>
                    <Input
                      id={`name-${team.id}`}
                      value={fields.name}
                      onChange={(event) => patch({ name: event.target.value })}
                      className="h-8"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`manager-${team.id}`}>Manager</Label>
                    <Input
                      id={`manager-${team.id}`}
                      value={fields.managerName}
                      onChange={(event) =>
                        patch({ managerName: event.target.value })
                      }
                      className="h-8"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                    <NumberField
                      label="Wins"
                      value={fields.wins}
                      onChange={(wins) => patch({ wins })}
                    />
                    <NumberField
                      label="Losses"
                      value={fields.losses}
                      onChange={(losses) => patch({ losses })}
                    />
                    <NumberField
                      label="Ties"
                      value={fields.ties}
                      onChange={(ties) => patch({ ties })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Points for"
                      value={fields.pointsFor}
                      step="0.01"
                      onChange={(pointsFor) => patch({ pointsFor })}
                    />
                    <NumberField
                      label="FAAB"
                      value={fields.faabBalance}
                      onChange={(faabBalance) => patch({ faabBalance })}
                    />
                  </div>

                  <div className="flex items-end gap-2 sm:col-span-3">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === `save:${team.id}`}
                      onClick={() =>
                        run(
                          `save:${team.id}`,
                          () => actions.update(team.id, fields),
                          () => {
                            setEditing(null);
                            setFields(null);
                          },
                        )
                      }
                    >
                      {busy === `save:${team.id}` ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : null}
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                        setFields(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {index < teams.length - 1 ? <RailLine /> : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
