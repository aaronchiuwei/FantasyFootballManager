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

export function injuryLabel(status: string | null): string | null {
  if (!status) return null;
  const key = status.trim().toUpperCase().replace(/[\s.]/g, "");
  return INJURY_LABELS[key] ?? status;
}

/**
 * §6 wants `injury_status` in the value engine, and it is — on the model tier.
 * Here it is only the label, but it rides on every surface that names a
 * player, because a value the market set last week is not a claim about a
 * player who is on IR today.
 */
export function InjuryBadge({ status }: { status: string | null }) {
  const label = injuryLabel(status);
  if (!label) return null;

  return (
    <Badge variant="destructive" className="shrink-0">
      {label}
    </Badge>
  );
}
