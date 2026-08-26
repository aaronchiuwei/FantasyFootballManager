import { redirect } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { signOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";

/**
 * Second gate. The middleware already redirects signed-out visitors, but the
 * layout re-checks because middleware alone is not an authorization boundary.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        {/* Three items on one row is 415px of content on a 375px screen, so on
            a phone the nav drops to a second row instead of squeezing the
            wordmark or the sign-out control. `order-*` puts it back beside the
            wordmark from `sm` up, where it fits. */}
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="min-w-0 flex-1 truncate font-semibold tracking-tight sm:flex-none"
          >
            Fantasy Football Manager
          </Link>

          <nav className="order-last flex w-full items-center gap-4 text-sm text-muted-foreground sm:order-none sm:mr-auto sm:w-auto">
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/leagues" className="hover:text-foreground">
              Leagues
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden max-w-[16rem] truncate text-sm text-muted-foreground md:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* `px-4` on a phone: the values board and the waiver wire are tables
          that already scroll sideways, and twelve pixels a side is a column. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
