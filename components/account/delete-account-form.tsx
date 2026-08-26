"use client";

import { useActionState, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GreaseNote } from "@/components/board/panel";
import { FormNotice, SubmitButton } from "@/components/account/account-form";
import {
  deleteAccountAction,
  type AccountState,
} from "@/app/(app)/account/actions";

/**
 * The one control on the board that takes the board down.
 *
 * Two steps, because there is no undo and no dialog in this world to hold the
 * question: the switch has to be armed before it can be thrown, and arming it
 * means writing the account's own email back by hand. The typed value is
 * checked here for the button state and again on the server, which is the
 * check that counts.
 */
export function DeleteAccountForm({ email }: { email: string }) {
  const [state, formAction] = useActionState<AccountState, FormData>(
    deleteAccountAction,
    {},
  );
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");

  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  if (!armed) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormNotice state={state} />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => setArmed(true)}
        >
          <TriangleAlertIcon aria-hidden />
          Delete account
        </Button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] p-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)] sm:p-4"
    >
      <GreaseNote tone="strike">
        This cannot be undone.
      </GreaseNote>

      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="account-delete-confirm">
          Type {email} to confirm
        </Label>
        <Input
          id="account-delete-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-invalid={typed.length > 0 && !matches}
          required
        />
      </div>

      <FormNotice state={state} />

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          label="Permanently delete"
          pending="Deleting"
          variant="destructive"
          disabled={!matches}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setArmed(false);
            setTyped("");
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
