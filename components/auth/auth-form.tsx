"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, TriangleAlertIcon, CircleCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RailLine } from "@/components/board/rail";
import type { AuthState } from "@/app/(auth)/actions";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in",
    description: "Open your league board.",
    submit: "Sign in",
    pending: "Signing in",
    footer: "Need an account?",
    footerHref: "/signup",
    footerCta: "Create one",
    autoComplete: "current-password",
  },
  "sign-up": {
    title: "Create account",
    description: "One account, then link your Yahoo league.",
    submit: "Create account",
    pending: "Creating",
    footer: "Already have an account?",
    footerHref: "/login",
    footerCta: "Sign in",
    autoComplete: "new-password",
  },
} as const;

function SubmitButton({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();

  return (
    <Button type="submit" size="lg" className="w-full" disabled={status.pending}>
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

/**
 * Not a card. A panel mounted by the door: a stencilled head, a channel rule
 * under it, and fields cut into the board. Messages are written in grease
 * pencil beside their icon rather than boxed, which is how every other
 * annotation in this app behaves.
 */
export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: Mode;
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const copy = COPY[mode];
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});

  return (
    <div className="animate-seat w-full">
      <h1 className="stencil text-sm text-foreground">{copy.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {copy.description}
      </p>

      <RailLine className="my-5" />

      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={copy.autoComplete}
            minLength={mode === "sign-up" ? 8 : undefined}
            required
          />
          {mode === "sign-up" ? (
            <p className="text-xs text-muted-foreground">
              At least 8 characters.
            </p>
          ) : null}
        </div>

        {state.error ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm leading-relaxed text-destructive"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.error}
          </p>
        ) : null}

        {state.message ? (
          <p
            role="status"
            className="flex items-start gap-2 text-sm leading-relaxed text-success"
          >
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.message}
          </p>
        ) : null}

        <SubmitButton label={copy.submit} pending={copy.pending} />
      </form>

      <p className="mt-5 text-sm text-muted-foreground">
        {copy.footer}{" "}
        <Link
          href={copy.footerHref}
          className="font-medium text-foreground underline underline-offset-4 decoration-grease decoration-2"
        >
          {copy.footerCta}
        </Link>
      </p>
    </div>
  );
}
