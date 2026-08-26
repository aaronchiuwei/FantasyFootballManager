import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The shadcn Card API survives, but what it renders no longer does. In this
 * world there are no floating cards: a Card is a REGION OF THE BOARD, marked
 * by a stencilled head, ruled off by a channel hairline, and recessed a shade
 * into the wall rather than raised off it.
 *
 * That is a deliberate structural choice, not a style. A recess cannot be
 * stacked on a recess and read as anything, so nesting one of these inside
 * another looks visibly wrong the moment it happens, which is exactly the
 * feedback a card system should give.
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) rounded-xs py-(--card-spacing)",
        "bg-[color-mix(in_oklch,var(--board-panel)_72%,transparent)]",
        "shadow-[inset_0_1px_0_color-mix(in_oklch,var(--channel-lip)_26%,transparent),inset_0_-1px_0_color-mix(in_oklch,var(--board-deep)_45%,transparent)]",
        "text-sm text-card-foreground",
        "[--card-spacing:--spacing(4)] data-[size=sm]:[--card-spacing:--spacing(3)]",
        "has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 px-(--card-spacing)",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        "has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "[.border-b]:border-b-0 [.border-b]:pb-(--card-spacing)",
        // The head is ruled off by the channel hairline, never by a border.
        "[.border-b]:relative [.border-b]:after:absolute [.border-b]:after:inset-x-0 [.border-b]:after:bottom-0 [.border-b]:after:h-0.5 [.border-b]:after:content-[''] [.border-b]:after:bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--channel-lip)_55%,transparent)_0,color-mix(in_oklch,var(--channel-lip)_55%,transparent)_1px,color-mix(in_oklch,var(--board-deep)_50%,transparent)_1px)]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "stencil text-[0.6875rem] text-chalk-dim group-data-[size=sm]/card:text-[0.625rem]",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("max-w-[68ch] text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "relative flex items-center border-t-0 p-(--card-spacing)",
        "bg-[color-mix(in_oklch,var(--board-deep)_35%,transparent)]",
        "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:content-['']",
        "before:bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--channel-lip)_55%,transparent)_0,color-mix(in_oklch,var(--channel-lip)_55%,transparent)_1px,color-mix(in_oklch,var(--board-deep)_50%,transparent)_1px)]",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
