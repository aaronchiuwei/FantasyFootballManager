"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { disconnectYahoo } from "@/lib/sources/yahoo-auth";
import { getSiteUrl } from "@/lib/site-url";

export type AccountState = { error?: string; message?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=%2Faccount");
  return { supabase, user };
}

/**
 * Starts an email change. Supabase mails a confirmation link to the new
 * address and leaves the old one signed in until it is clicked, so the answer
 * here is always "check your mail", never "done".
 */
export async function changeEmailAction(
  _prevState: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const { supabase, user } = await requireUser();
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Enter an email address." };
  }
  if (email.toLowerCase() === (user.email ?? "").toLowerCase()) {
    return { error: "That is already your email address." };
  }

  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${getSiteUrl()}/auth/callback?next=%2Faccount` },
  );

  if (error) {
    return { error: error.message };
  }

  return {
    message: `Check ${email} for a link that confirms the change. Your current address keeps working until you click it.`,
  };
}

export async function changePasswordAction(
  _prevState: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const { supabase } = await requireUser();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match." };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  return { message: "Password updated. Other devices stay signed in." };
}

/**
 * Deletes the account and everything hanging off it.
 *
 * Every user-scoped table references `auth.users (id) on delete cascade`, so
 * removing the auth user is what actually clears leagues, teams, rosters,
 * values, sync runs and saved trades. `yahoo_tokens` cascades too, but it is
 * revoked first and explicitly: it is the only row here that is a credential,
 * and a failure further down should never leave one behind.
 *
 * Confirmation is the account's own email typed back, which is deliberate for
 * an action with no undo and no dialog primitive in this app to hold it.
 */
export async function deleteAccountAction(
  _prevState: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const { supabase, user } = await requireUser();
  const typed = String(formData.get("confirm") ?? "").trim();

  if (typed.toLowerCase() !== (user.email ?? "").trim().toLowerCase()) {
    return { error: "Type your email address exactly as shown to confirm." };
  }

  try {
    await disconnectYahoo(user.id);

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return { error: error.message };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "Could not delete the account. Nothing was removed.",
    };
  }

  // The account is gone by this point, so a failure clearing the cookie is not
  // worth reporting as a failed deletion: the session it names no longer
  // resolves to a user, and the middleware sends it to the door regardless.
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignored on purpose.
  }

  revalidatePath("/", "layout");
  redirect("/login?deleted=1");
}
