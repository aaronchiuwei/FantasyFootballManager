"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Calculator, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { computeValuesAction } from "@/app/(app)/leagues/[id]/values/actions";

export function ComputeValuesButton({
  leagueId,
  label = "Compute values",
  variant,
}: {
  leagueId: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const { error, report } = await computeValuesAction(leagueId);

          if (error || !report) {
            toast.error(error ?? "Valuation failed.");
            return;
          }

          toast.success(`${report.valued.toLocaleString()} players valued.`, {
            description: `${report.bySource.market} market · ${
              report.bySource.model + report.bySource.model_capped
            } modelled${report.bySource.floor ? ` · ${report.bySource.floor} unvalued` : ""}`,
          });

          // §13's invariants are checked on every run, not just in tests. The
          // natural home for these is `sync_runs.stages` once Phase 4 gives
          // the pipeline a durable progress record; until then they surface
          // here, where someone is watching.
          if (report.seamViolations > 0) {
            toast.warning(
              `${report.seamViolations} modelled players outrank a market-priced player at their position.`,
            );
          }

          if (report.rankCorrelation !== null && report.rankCorrelation < 0.98) {
            toast.warning(
              `Fit correlates with FantasyCalc at ${report.rankCorrelation.toFixed(3)} across ${report.overlap} players.`,
              {
                description:
                  "Below §13's 0.98 target — expected, since a single curve has to span positions the market prices very differently.",
              },
            );
          }

          for (const warning of report.warnings) toast.warning(warning);
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Calculator className="size-4" aria-hidden />
      )}
      {label}
    </Button>
  );
}
