import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A badge here is a stamped chip: a small squared field with the code struck
 * into it. Not a pill. The world is cut aluminium and engraved laminate, so
 * the corner language is the same 2px chamfer everything else uses.
 */
const badgeVariants = cva(
  [
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-xs px-1.5",
    "font-plate text-[0.625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap",
    "transition-colors duration-(--motion-fast) ease-(--ease-out)",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "[&>svg]:pointer-events-none [&>svg]:size-2.5!",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary:
          "bg-channel text-foreground shadow-[inset_0_1px_0_color-mix(in_oklch,var(--channel-lip)_50%,transparent)]",
        destructive:
          "bg-[color-mix(in_oklch,var(--destructive)_18%,transparent)] text-destructive shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--destructive)_42%,transparent)]",
        outline:
          "text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--channel-lip)_38%,transparent)]",
        ghost: "text-muted-foreground hover:bg-channel hover:text-foreground",
        link: "text-primary normal-case tracking-normal underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
