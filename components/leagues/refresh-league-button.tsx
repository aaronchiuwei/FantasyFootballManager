"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { refreshLeagueAction } from "@/app/(app)/leagues/actions";

export function RefreshLeagueButton({
  leagueId,
  leagueKey,
}: {
  leagueId: string;
  leagueKey: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await refreshLeagueAction(leagueId, leagueKey);
          if (result.error) toast.error(result.error);
          else toast.success("League refreshed from Yahoo.");
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      Refresh
    </Button>
  );
}
