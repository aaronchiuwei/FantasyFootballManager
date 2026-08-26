import { redirect } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BoardNav } from "@/components/board/board-nav";
import { ThemeToggle } from "@/components/board/theme-toggle";
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
      {/* The head of the board: the wall's own title stencilled on it, the
          sections ruled across, and the fixture switch at the far end. The
          channel hairline underneath is the rail this whole header sits in. */}
      <header
        className={[
          "sticky top-0 z-30",
          "bg-[color-mix(in_oklch,var(--board-deep)_88%,transparent)] backdrop-blur-sm",
          "shadow-[inset_0_-1px_0_color-mix(in_oklch,var(--board-deep)_70%,transparent),0_1px_0_color-mix(in_oklch,var(--channel-lip)_30%,transparent)]",
        ].join(" ")}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center gap-x-5 px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="group/mark flex min-w-0 shrink-0 items-center gap-2.5 py-2.5"
          >
            <span
              aria-hidden
              className="h-6 w-1 shrink-0 rounded-xs bg-grease"
            />
            <span className="flex min-w-0 flex-col leading-none">
              <span className="stencil text-[0.5625rem] text-chalk-dim">
                Fantasy Football
              </span>
              <span className="stencil mt-0.5 text-[0.8125rem] text-foreground">
                Manager
              </span>
            </span>
          </Link>

          {/* On a phone the sections drop to their own rail rather than
              squeezing the wall title or the sign-out control. */}
          <BoardNav
            className="ml-auto hidden sm:flex"
            items={[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/leagues", label: "Leagues" },
              { href: "/trade", label: "Analyzer" },
            ]}
          />

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
            <span className="hidden max-w-[15rem] truncate text-xs text-muted-foreground lg:inline">
              {user.email}
            </span>
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl px-2 sm:hidden">
          <BoardNav
            items={[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/leagues", label: "Leagues" },
              { href: "/trade", label: "Analyzer" },
            ]}
          />
        </div>
      </header>

      {/* px-4 on a phone: the values board and the waiver wire are tables that
          already scroll sideways, and twelve pixels a side is a column. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
