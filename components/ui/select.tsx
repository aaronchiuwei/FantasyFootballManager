import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A rotary selector, not a popover.
 *
 * Deliberately the platform's own `<select>`. Everything it is used for here —
 * which team, which slot, which week — is a short closed list inside a form
 * that posts, and the native control gets keyboard, touch and screen readers
 * right for free while a Radix listbox would need a hidden input to be
 * submitted at all. The chevron is drawn as a background image rather than an
 * overlaid element so the control stays one node and one focus ring.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 appearance-none rounded-xs py-1 pl-2.5 pr-8 text-base md:text-sm",
        "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] text-foreground",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m4%206%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]",
        "bg-[length:1rem_1rem] bg-[position:right_0.5rem_center] bg-no-repeat",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent),inset_0_0_0_1px_color-mix(in_oklch,var(--channel-lip)_20%,transparent)]",
        "transition-[box-shadow,background-color] duration-(--motion-fast) ease-(--ease-out)",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        // The dropdown itself is painted by the OS, which does not read our
        // custom properties. Without this the open list is white text on white
        // in dark mode on Chrome.
        "[&>option]:bg-background [&>option]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
