import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { signIn } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return <AuthForm mode="sign-in" action={signIn} next={next} />;
}
