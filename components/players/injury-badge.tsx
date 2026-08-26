import { Badge } from "@/components/ui/badge";

/** Sleeper's own spellings, shortened to something that fits next to a name. */
const INJURY_LABELS: Record<string, string> = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "OUT",
  IR: "IR",
  PUP: "PUP",
  SUS: "SUS",
  NA: "NA",
  COV: "COV",
};

/** The long form, for the places that have room to spell it out. */
const INJURY_NAMES: Record<string, string> = {
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  IR: "Injured reserve",
  PUP: "Physically unable to perform",
  SUS: "Suspended",
  NA: "Not active",
  COV: "COVID list",
};

function injuryKey(status: string): string {
  return status.trim().toUpperCase().replace(/[\s.]/g, "");
}

export function injuryLabel(status: string | null): string | null {
  if (!status) return null;
  return INJURY_LABELS[injuryKey(status)] ?? status;
}

/**
 * The sentence a badge is standing in for. Sleeper's `injury_status` says how
 * available a player is; Yahoo's `injury_note` says why — "Knee", "Hamstring".
 * They are different questions and the note is the one a manager deciding
 * whether to buy the dip is actually asking, so the two are printed together
 * wherever there is room for a phrase instead of two letters.
 */
export function injuryDescription(
  status: string | null,
  note?: string | null,
): string | null {
  if (!status) return null;
  const name = INJURY_NAMES[injuryKey(status)] ?? status;
  const reason = note?.trim();
  return reason ? `${name} — ${reason}` : name;
}

/**
 * §6 wants `injury_status` in the value engine, and it is — on the model tier.
 * Here it is only the label, but it rides on every surface that names a
 * player, because a value the market set last week is not a claim about a
 * player who is on IR today.
 *
 * `note` is Yahoo's free text and is deliberately never valued — it goes in
 * the tooltip, where it costs no width on a dense row.
 */
export function InjuryBadge({
  status,
  note = null,
}: {
  status: string | null;
  note?: string | null;
}) {
  const label = injuryLabel(status);
  if (!label) return null;

  return (
    <Badge
      variant="destructive"
      className="shrink-0"
      title={injuryDescription(status, note) ?? undefined}
    >
      {label}
    </Badge>
  );
}
