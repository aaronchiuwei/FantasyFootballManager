"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { disconnectYahooAction } from "@/app/(app)/leagues/actions";

export function DisconnectYahooButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => disconnectYahooAction())}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      Disconnect
    </Button>
  );
}
