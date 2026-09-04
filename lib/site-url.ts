/**
 * Absolute origin for links Supabase mails back to the app (confirmation,
 * password reset) and for the Yahoo OAuth redirect in Phase 1.
 */
export function getSiteUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    // The project's stable production domain. Preferred over `VERCEL_URL`,
    // which names *this deployment* — a `project-hash-team.vercel.app` address
    // that Vercel Authentication protects by default. The sync pipeline calls
    // its own origin to chain stages, so a protected address means the app
    // cannot reach itself and every stage after the first 401s. It is also the
    // wrong thing to put in a password-reset email, which outlives the deploy.
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "http://localhost:3000";

  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}
