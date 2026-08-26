"use client";

import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormNotice, SubmitButton } from "@/components/account/account-form";
import {
  changeEmailAction,
  type AccountState,
} from "@/app/(app)/account/actions";

export function ChangeEmailForm({ current }: { current: string }) {
  const [state, formAction] = useActionState<AccountState, FormData>(
    changeEmailAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="account-email">New email</Label>
        <Input
          id="account-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={current}
          required
        />
      </div>

      <FormNotice state={state} />

      <div>
        <SubmitButton label="Send confirmation" pending="Sending" />
      </div>
    </form>
  );
}
