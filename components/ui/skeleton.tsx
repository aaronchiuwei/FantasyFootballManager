import { cn } from "@/lib/utils"

/**
 * Loading is an empty seat in the channel, not a grey pill. The board shows
 * the slot a plate is about to drop into, at the size that plate will be, so
 * nothing shifts when the data lands.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-xs",
        "bg-[color-mix(in_oklch,var(--board-deep)_80%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
