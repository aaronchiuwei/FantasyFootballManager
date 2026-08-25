/**
 * Absolute origin for links Supabase mails back to the app (confirmation,
 * password reset) and for the Yahoo OAuth redirect in Phase 1.
 */
export function getSiteUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "http://localhost:3000";

  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}
