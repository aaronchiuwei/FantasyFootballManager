"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The board's top rail. Sections are stencilled straight onto the wall, and
 * the one you are standing in front of is marked in grease pencil.
 *
 * The mark is drawn under the label rather than behind it: a highlighted pill
 * would be a second container in a world that has decided not to have any.
 */
export function BoardNav({
  items,
  className,
}: {
  items: { href: string; label: string; match?: (path: string) => boolean }[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex min-w-0 items-stretch", className)}>
      {items.map((item) => {
        const active = item.match
          ? item.match(pathname)
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "stencil relative flex items-center px-3 py-2.5 whitespace-nowrap",
              "transition-colors duration-(--motion-fast) ease-(--ease-out)",
              "after:absolute after:inset-x-2.5 after:bottom-1.5 after:h-0.5 after:content-['']",
              "after:origin-left after:scale-x-0 after:bg-grease",
              "after:transition-transform after:duration-(--motion-base) after:ease-(--ease-out)",
              active
                ? "text-foreground after:scale-x-100"
                : "text-chalk-dim hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
