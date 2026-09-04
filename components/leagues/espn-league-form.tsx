"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/board/panel";
import { FIRST_ESPN_SEASON } from "@/lib/leagues/espn-input";

export type EspnFormState = { error?: string };

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p className="max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const status = useFormStatus();

  return (
    <Button type="submit" disabled={status.pending}>
      {status.pending ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Reading the league
        </>
      ) : (
        "Connect league"
      )}
    </Button>
  );
}

/**
 * The ESPN connect form.
 *
 * Two boxes for a public league, four for a private one, and the second pair
 * is behind a disclosure because most of the time it is not needed and asking
 * everyone for browser cookies up front reads like a phishing page.
 *
 * `defaultSeason` and `defaultsOpen` come from the server so this renders the
 * same on both sides of hydration — the season a league belongs to is a fact
 * about today, and today is not something a client component should be
 * deciding on its own.
 */
export function EspnLeagueForm({
  action,
  defaultSeason,
  hasStoredCookies,
}: {
  action: (
    state: EspnFormState,
    formData: FormData,
  ) => Promise<EspnFormState>;
  defaultSeason: number;
  /** Whether a pair is already saved, in which case the boxes stay empty. */
  hasStoredCookies: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const [showCookies, setShowCookies] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <Panel
        label="The league"
        note="Both of these are on the league's URL in ESPN — you can paste the whole URL into the first box and the season will be read out of it."
      >
        <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field
            label="League ID or URL"
            htmlFor="leagueId"
            hint="For example 123456, or https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2026"
          >
            <Input
              id="leagueId"
              name="leagueId"
              inputMode="text"
              autoComplete="off"
              placeholder="123456"
              required
            />
          </Field>

          <Field label="Season" htmlFor="season">
            <Input
              id="season"
              name="season"
              type="number"
              min={FIRST_ESPN_SEASON}
              max={defaultSeason + 1}
              defaultValue={defaultSeason}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        label="Private league"
        note={
          hasStoredCookies
            ? "Your ESPN cookies are already saved. Leave these blank unless ESPN has stopped accepting them, in which case a fresh pair replaces the old one."
            : "A public league needs nothing here. A private one needs the two cookies your own browser already holds — they are encrypted before they are stored, and they never leave the server."
        }
        action={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowCookies((open) => !open)}
          >
            {showCookies ? "Hide" : "Add cookies"}
          </Button>
        }
      >
        {showCookies ? (
          <div className="flex flex-col gap-5">
            <Field
              label="SWID"
              htmlFor="swid"
              hint="In your browser, open fantasy.espn.com while signed in, then read the SWID cookie. It looks like {AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}."
            >
              <Input
                id="swid"
                name="swid"
                autoComplete="off"
                spellCheck={false}
                placeholder="{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"
              />
            </Field>

            <Field
              label="espn_s2"
              htmlFor="espnS2"
              hint="The long one, from the same place. It is a session cookie for your ESPN account, so treat it like a password — this app stores it encrypted and uses it only to read your leagues."
            >
              <Input
                id="espnS2"
                name="espnS2"
                autoComplete="off"
                spellCheck={false}
                placeholder="AEB..."
              />
            </Field>
          </div>
        ) : null}
      </Panel>

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
        <SubmitButton />
      </div>
    </form>
  );
}
