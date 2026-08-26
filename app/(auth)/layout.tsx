import Link from "next/link";

import { ThemeToggle } from "@/components/board/theme-toggle";

/**
 * The door to the room. Split: the wall on the left with the board's title
 * stencilled on it, the sign-in panel mounted on the right. On a phone the
 * wall becomes a header band and the panel takes the rest.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section className="relative flex flex-col justify-between gap-10 px-6 py-8 sm:px-10 lg:py-12">
        <Link href="/" className="flex w-fit items-center gap-2.5">
          <span aria-hidden className="h-6 w-1 shrink-0 rounded-xs bg-grease" />
          <span className="flex flex-col leading-none">
            <span className="stencil text-[0.5625rem] text-chalk-dim">
              Fantasy Football
            </span>
            <span className="stencil mt-0.5 text-[0.8125rem] text-foreground">
              Manager
            </span>
          </span>
        </Link>

        <p className="hidden max-w-[18ch] text-balance font-plate text-4xl leading-[1.05] font-bold tracking-[-0.015em] text-foreground lg:block">
          Know who wins the trade before you accept it.
        </p>

        <p className="hidden max-w-[52ch] text-sm leading-relaxed text-muted-foreground lg:block">
          Market-grounded values with their sources attached, for Yahoo redraft
          leagues.
        </p>
      </section>

      <main
        className={[
          "flex flex-col justify-center gap-6 px-6 py-10 sm:px-10 lg:px-9",
          "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)]",
          "shadow-[inset_0_1px_0_color-mix(in_oklch,var(--channel-lip)_28%,transparent)]",
          "lg:shadow-[inset_1px_0_0_color-mix(in_oklch,var(--channel-lip)_28%,transparent)]",
        ].join(" ")}
      >
        {children}
        <div className="flex justify-start">
          <ThemeToggle />
        </div>
      </main>
    </div>
  );
}
