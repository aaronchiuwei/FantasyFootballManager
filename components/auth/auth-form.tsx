"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AuthState } from "@/app/(auth)/actions";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to your league workspace.",
    submit: "Sign in",
    pending: "Signing in…",
    footer: "Need an account?",
    footerHref: "/signup",
    footerCta: "Create one",
    autoComplete: "current-password",
  },
  "sign-up": {
    title: "Create your account",
    description: "One account, then link your Yahoo league.",
    submit: "Create account",
    pending: "Creating account…",
    footer: "Already have an account?",
    footerHref: "/login",
    footerCta: "Sign in",
    autoComplete: "new-password",
  },
} as const;

function SubmitButton({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={status.pending}>
      {status.pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pending}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>

      <form action={formAction}>
        <CardContent className="space-y-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={copy.autoComplete}
              minLength={mode === "sign-up" ? 8 : undefined}
              required
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          {state.message ? (
            <p
              role="status"
              className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
            >
              {state.message}
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="mt-6 flex-col gap-3">
          <SubmitButton label={copy.submit} pending={copy.pending} />
          <p className="text-sm text-muted-foreground">
            {copy.footer}{" "}
            <Link
              href={copy.footerHref}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {copy.footerCta}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
