"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A detented control running in a channel. The track is the same recessed
 * slot every measured bar in this app uses, divided by the graticule so the
 * setting can be read by counting rather than by reading a tooltip, and the
 * thumb is a knurled slug seated in it.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none",
        "data-disabled:opacity-45",
        "data-vertical:h-full data-vertical:min-h-44 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-xs",
          "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
          "shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]",
          "data-horizontal:h-2 data-horizontal:w-full data-vertical:h-full data-vertical:w-2"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary data-horizontal:h-full data-vertical:w-full"
        />
        <span aria-hidden className="graticule absolute inset-0" />
      </SliderPrimitive.Track>
      {Array.from({ length: values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(
            "block h-5 w-3 shrink-0 rounded-xs bg-channel-lip",
            "shadow-[inset_0_1px_0_color-mix(in_oklch,white_50%,transparent),inset_0_-1px_0_color-mix(in_oklch,var(--board-deep)_60%,transparent),0_1px_2px_color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
            "transition-[box-shadow,background-color] duration-(--motion-fast) ease-(--ease-out)",
            "hover:bg-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "disabled:pointer-events-none disabled:opacity-45"
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
