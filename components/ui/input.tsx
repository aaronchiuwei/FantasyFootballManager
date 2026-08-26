import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A field cut into the board: recessed, with the shadow falling from the top
 * edge inward, so it reads as a slot you write into rather than a box laid on
 * top. The caret and selection are already grease pencil, set globally.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-xs px-2.5 py-1 text-base md:text-sm",
        "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] text-foreground",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent),inset_0_0_0_1px_color-mix(in_oklch,var(--channel-lip)_20%,transparent)]",
        "transition-[box-shadow,background-color] duration-(--motion-fast) ease-(--ease-out)",
        "outline-none placeholder:text-muted-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-plate file:text-xs file:font-semibold file:uppercase file:tracking-[0.09em] file:text-foreground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent),inset_0_0_0_1px_var(--destructive)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
