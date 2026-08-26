"use client";

import { useFormStatus } from "react-dom";
import { Loader2, TriangleAlertIcon, CircleCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccountState } from "@/app/(app)/account/actions";

/**
 * The shared parts of the account forms.
 *
 * Answers are written beside their icon in grease pencil rather than boxed,
 * the same way the sign-in panel and every other annotation in this app
 * reports back.
 */
export function FormNotice({ state }: { state: AccountState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 text-sm leading-relaxed text-destructive"
      >
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  }

  if (state.message) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 text-sm leading-relaxed text-success"
      >
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.message}
      </p>
    );
  }

  return null;
}

export function SubmitButton({
  label,
  pending,
  variant = "outline",
  disabled = false,
}: {
  label: string;
  pending: string;
  variant?: "default" | "outline" | "destructive";
  disabled?: boolean;
}) {
  const status = useFormStatus();

  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={disabled || status.pending}
    >
      {status.pending ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {pending}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
