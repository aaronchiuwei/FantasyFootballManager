"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** A field's label is stencilled above it, the way a panel marks its inputs. */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "stencil flex items-center gap-2 text-chalk-dim select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-45",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-45",
        className
      )}
      {...props}
    />
  )
}

export { Label }
