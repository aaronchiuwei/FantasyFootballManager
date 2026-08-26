import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A control on the board is a machined switch: a squared plate with a lit top
 * lip that physically pushes in. The press is `translateY(1px)` with the lip
 * highlight collapsing, not a scale, because a switch mounted in a panel
 * travels along one axis. Labels are stencilled in condensed caps, the way a
 * control is marked on real equipment, which is also why they stay short.
 */
const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xs",
    "font-plate font-semibold uppercase tracking-[0.09em] whitespace-nowrap select-none",
    "transition-[transform,background-color,color,box-shadow] duration-(--motion-fast) ease-(--ease-out)",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50",
    "aria-invalid:outline-2 aria-invalid:outline-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      variant: {
        // The grease pencil: the one action the surface actually wants.
        default: [
          "bg-primary text-primary-foreground",
          "shadow-[inset_0_1px_0_color-mix(in_oklch,white_45%,transparent),0_1px_0_color-mix(in_oklch,var(--board-deep)_60%,transparent)]",
          "hover:bg-[color-mix(in_oklch,var(--primary),white_10%)]",
          "active:shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_35%,transparent)]",
        ],
        // A bare control cut into the board.
        outline: [
          "bg-[color-mix(in_oklch,var(--channel)_55%,transparent)] text-foreground",
          "shadow-[inset_0_1px_0_color-mix(in_oklch,var(--channel-lip)_70%,transparent),inset_0_0_0_1px_color-mix(in_oklch,var(--channel-lip)_28%,transparent)]",
          "hover:bg-[color-mix(in_oklch,var(--channel)_85%,transparent)]",
          "aria-expanded:bg-channel",
          "active:shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
        ],
        secondary: [
          "bg-channel text-foreground",
          "shadow-[inset_0_1px_0_color-mix(in_oklch,var(--channel-lip)_60%,transparent)]",
          "hover:bg-[color-mix(in_oklch,var(--channel),var(--channel-lip)_28%)]",
          "active:shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
        ],
        ghost: [
          "text-muted-foreground",
          "hover:bg-[color-mix(in_oklch,var(--channel)_60%,transparent)] hover:text-foreground",
          "aria-expanded:bg-channel aria-expanded:text-foreground",
        ],
        destructive: [
          "bg-[color-mix(in_oklch,var(--destructive)_16%,transparent)] text-destructive",
          "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--destructive)_40%,transparent)]",
          "hover:bg-[color-mix(in_oklch,var(--destructive)_26%,transparent)]",
          "focus-visible:outline-destructive",
        ],
        // Reads as written on the board rather than mounted in it.
        link: [
          "text-primary normal-case tracking-normal underline-offset-4",
          "hover:underline active:translate-y-0",
        ],
      },
      size: {
        default: "h-8 px-3 text-[0.6875rem]",
        xs: "h-6 px-2 text-[0.5625rem] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 px-2.5 text-[0.625rem] [&_svg:not([class*='size-'])]:size-3",
        lg: "h-10 px-5 text-xs",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
