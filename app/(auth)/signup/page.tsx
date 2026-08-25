import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { signUp } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return <AuthForm mode="sign-up" action={signUp} next={next} />;
}
