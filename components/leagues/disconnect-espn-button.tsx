"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { disconnectEspnAction } from "@/app/(app)/leagues/actions";

export function DisconnectEspnButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => disconnectEspnAction())}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      Forget cookies
    </Button>
  );
}
