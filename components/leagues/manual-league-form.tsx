"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/board/panel";
import { SCORING_PRESETS, type ScoringPresetKey } from "@/lib/leagues/manual-input";

export type ManualFormState = { error?: string };

export type ManualFormDefaults = {
  name: string;
  season: number;
  ppr: number;
  scoringLabel: string | null;
  lineup: string;
  isDynasty: boolean;
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
  /** Only the creation form asks for these. */
  teams?: string;
};

/** The lineup every default 12-team Yahoo league starts, as a starting point. */
export const DEFAULT_LINEUP = "QB, 2×RB, 3×WR, TE, W/R/T, K, DEF, 6×BN, IR";

export const BLANK_MANUAL_LEAGUE: ManualFormDefaults = {
  name: "",
  season: new Date().getFullYear(),
  ppr: 0.5,
  scoringLabel: "Half PPR",
  lineup: DEFAULT_LINEUP,
  isDynasty: false,
  currentWeek: null,
  startWeek: 1,
  endWeek: 17,
  teams: "",
};

function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SubmitButton({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();

  return (
    <Button type="submit" disabled={status.pending}>
      {status.pending ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {pending}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

function presetFor(ppr: number, label: string | null): ScoringPresetKey {
  const match = SCORING_PRESETS.find(
    (preset) => preset.ppr === ppr && preset.label === label,
  );
  return match ? match.key : "custom";
}

/**
 * The league settings a Yahoo import would have read, asked for instead.
 *
 * One component for creating and for editing, because the two forms are the
 * same form — the only difference is whether it also names the teams, and a
 * second component that differed by one field would drift from this one within
 * a phase.
 *
 * §1.2 says scoring is read from the league and never hardcoded. With no API
 * to read it from, this *is* the read, so the two settings the value engine is
 * actually parameterised by get the most room: PPR, which selects the
 * FantasyCalc board, and the lineup, which sets every replacement rank. The
 * QB count is not asked for at all — it is derived from the lineup, because a
 * league that starts a superflex has already answered.
 */
export function ManualLeagueForm({
  action,
  defaults,
  submitLabel,
  pendingLabel,
  withTeams,
}: {
  action: (state: ManualFormState, formData: FormData) => Promise<ManualFormState>;
  defaults: ManualFormDefaults;
  submitLabel: string;
  pendingLabel: string;
  withTeams: boolean;
}) {
  const [state, formAction] = useActionState<ManualFormState, FormData>(
    action,
    {},
  );

  // The preset is a control over the PPR field, not a field of its own: it
  // writes a number into the input and the input is what posts. A league that
  // scores 0.75 picks Custom and types it, and nothing is lost.
  const [preset, setPreset] = useState<ScoringPresetKey>(
    presetFor(defaults.ppr, defaults.scoringLabel),
  );
  const [ppr, setPpr] = useState(String(defaults.ppr));

  const scoringLabel =
    SCORING_PRESETS.find((entry) => entry.key === preset)?.label ?? "Custom";

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="scoringLabel" value={scoringLabel} />

      <Panel label="League" note="What the board is called, and when it is played.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" className="sm:col-span-2">
            <Input
              id="name"
              name="name"
              defaultValue={defaults.name}
              placeholder="Sunday Money"
              maxLength={120}
              required
            />
          </Field>

          <Field label="Season" htmlFor="season">
            <Input
              id="season"
              name="season"
              type="number"
              inputMode="numeric"
              min={2000}
              max={2100}
              defaultValue={defaults.season}
              required
            />
          </Field>

          <Field
            label="Current week"
            htmlFor="currentWeek"
            hint="Leave blank in the off-season."
          >
            <Input
              id="currentWeek"
              name="currentWeek"
              type="number"
              inputMode="numeric"
              min={1}
              max={25}
              defaultValue={defaults.currentWeek ?? ""}
            />
          </Field>

          <Field label="First week" htmlFor="startWeek">
            <Input
              id="startWeek"
              name="startWeek"
              type="number"
              inputMode="numeric"
              min={1}
              max={25}
              defaultValue={defaults.startWeek ?? ""}
            />
          </Field>

          <Field
            label="Last week"
            htmlFor="endWeek"
            hint="Including the championship."
          >
            <Input
              id="endWeek"
              name="endWeek"
              type="number"
              inputMode="numeric"
              min={1}
              max={25}
              defaultValue={defaults.endWeek ?? ""}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        label="Scoring and lineup"
        note="These two set every price on the board: PPR picks the trade market, the lineup sets what a replacement-level player is worth."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scoring" htmlFor="preset">
            <Select
              id="preset"
              value={preset}
              onChange={(event) => {
                const key = event.target.value as ScoringPresetKey;
                setPreset(key);
                const found = SCORING_PRESETS.find((entry) => entry.key === key);
                if (found?.ppr !== null && found !== undefined) {
                  setPpr(String(found.ppr));
                }
              }}
            >
              {SCORING_PRESETS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Points per reception"
            htmlFor="ppr"
            hint="0 for standard, 0.5 for half, 1 for full."
          >
            <Input
              id="ppr"
              name="ppr"
              type="number"
              inputMode="decimal"
              step="0.05"
              min={0}
              max={3}
              value={ppr}
              onChange={(event) => {
                setPpr(event.target.value);
                setPreset("custom");
              }}
              required
            />
          </Field>

          <Field
            label="Roster slots"
            htmlFor="lineup"
            className="sm:col-span-2"
            hint={
              <>
                One slot per entry, in lineup order. Repeat a slot or write a
                count: <code>2×RB</code>, <code>WR x3</code>. Use{" "}
                <code>W/R/T</code> for a flex, <code>Q/W/R/T</code> for a
                superflex, <code>BN</code> for the bench and <code>IR</code> for
                injured reserve. Whether the league is superflex is read from
                this, not asked for.
              </>
            }
          >
            <Textarea
              id="lineup"
              name="lineup"
              rows={3}
              defaultValue={defaults.lineup}
              spellCheck={false}
              required
            />
          </Field>

          <div className="flex items-start gap-2.5 sm:col-span-2">
            <input
              id="isDynasty"
              name="isDynasty"
              type="checkbox"
              defaultChecked={defaults.isDynasty}
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="isDynasty">Keeper or dynasty league</Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Values here are redraft values either way. Ticking this puts the
                warning about that on the league page.
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {withTeams ? (
        <Panel
          label="Teams"
          note="One per line. The first is yours — you can move that later on this screen."
        >
          <Textarea
            id="teams"
            name="teams"
            rows={8}
            defaultValue={defaults.teams ?? ""}
            placeholder={"Your team\nThe Ditka Memorial\nRegression to the Mean\n…"}
            required
          />
        </Panel>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm leading-relaxed text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      ) : null}

      <div>
        <SubmitButton label={submitLabel} pending={pendingLabel} />
      </div>
    </form>
  );
}
