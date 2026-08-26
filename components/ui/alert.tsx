import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * An alert is written on the board in grease pencil, not boxed. It carries a
 * hand-drawn underline instead of a container, because the annotation layer of
 * a war room sits over the board rather than being mounted in it.
 *
 * Deliberately not a coloured left border: that is the tell this world avoids.
 */
const alertVariants = cva(
  [
    "group/alert relative grid w-full gap-1 py-2 pl-0 text-left text-sm",
    "has-data-[slot=alert-action]:pr-18",
    "has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5",
    "*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current",
    "*:[svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "text-foreground",
        destructive:
          "text-destructive *:data-[slot=alert-description]:text-destructive/85",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "grease-underline w-fit pb-0.5 font-plate font-semibold tracking-[0.01em]",
        "group-has-[>svg]/alert:col-start-2",
        "[&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "max-w-[68ch] text-sm leading-relaxed text-muted-foreground",
        "[&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        "[&_p:not(:last-child)]:mb-3",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-1 right-0", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
