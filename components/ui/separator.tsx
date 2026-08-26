"use client"

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** Every divider in this app is a channel rail seen edge on. */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-transparent",
        "data-horizontal:h-0.5 data-horizontal:w-full data-horizontal:bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--channel-lip)_55%,transparent)_0,color-mix(in_oklch,var(--channel-lip)_55%,transparent)_1px,color-mix(in_oklch,var(--board-deep)_50%,transparent)_1px)]",
        "data-vertical:w-0.5 data-vertical:self-stretch data-vertical:bg-[linear-gradient(to_right,color-mix(in_oklch,var(--board-deep)_50%,transparent)_0,color-mix(in_oklch,var(--board-deep)_50%,transparent)_1px,color-mix(in_oklch,var(--channel-lip)_45%,transparent)_1px)]",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
