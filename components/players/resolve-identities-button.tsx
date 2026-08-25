"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveIdentitiesAction } from "@/app/(app)/leagues/[id]/identity/actions";

export function ResolveIdentitiesButton({
  leagueId,
  label = "Resolve players",
}: {
  leagueId: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const { error, report } = await resolveIdentitiesAction(leagueId);

          if (error || !report) {
            toast.error(error ?? "Resolution failed.");
            return;
          }

          const rate =
            report.rostered === 0
              ? 100
              : Math.round((report.rosteredResolved / report.rostered) * 1000) / 10;

          toast.success(
            `${report.rosteredResolved}/${report.rostered} rostered players resolved (${rate}%).`,
            {
              description:
                report.unmatched === 0
                  ? "Nothing left to resolve by hand."
                  : `${report.unmatched} need a manual match.`,
            },
          );

          for (const warning of report.warnings) toast.warning(warning);
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Users className="size-4" aria-hidden />
      )}
      {label}
    </Button>
  );
}
