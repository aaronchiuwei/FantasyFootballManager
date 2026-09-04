import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A deeper cut of the same slot `Input` is. Same recess, same lip, no resize
 * handle in the corner — a control on this board is machined into it, and a
 * drag grip is a browser affordance, not a panel one. Height is set by `rows`
 * so the field's size is a property of what it holds.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 resize-none rounded-xs px-2.5 py-2 text-base md:text-sm",
        "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] text-foreground",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent),inset_0_0_0_1px_color-mix(in_oklch,var(--channel-lip)_20%,transparent)]",
        "transition-[box-shadow,background-color] duration-(--motion-fast) ease-(--ease-out)",
        "outline-none placeholder:text-muted-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent),inset_0_0_0_1px_var(--destructive)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
