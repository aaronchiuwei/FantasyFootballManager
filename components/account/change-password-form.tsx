"use client";

import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormNotice, SubmitButton } from "@/components/account/account-form";
import {
  changePasswordAction,
  type AccountState,
} from "@/app/(app)/account/actions";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<AccountState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:max-w-lg sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-password">New password</Label>
          <Input
            id="account-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="account-password-confirm">Repeat it</Label>
          <Input
            id="account-password-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
      </div>

      <FormNotice state={state} />

      <div>
        <SubmitButton label="Update password" pending="Updating" />
      </div>
    </form>
  );
}
