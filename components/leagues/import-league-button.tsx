"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importLeagueAction } from "@/app/(app)/leagues/actions";

export function ImportLeagueButton({
  leagueKey,
  label = "Import",
  variant = "default",
}: {
  leagueKey: string;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await importLeagueAction(leagueKey);
          if (result?.error) toast.error(result.error);
        })
      }
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Importing…
        </>
      ) : (
        label
      )}
    </Button>
  );
}
