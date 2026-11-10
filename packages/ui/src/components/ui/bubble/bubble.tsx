"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { cn } from "cn"
import type * as React from "react"

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit max-w-[647px] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full",
  {
    variants: {
      variant: {
        default:
          "*:data-[slot=bubble-content]:bg-primary-500 *:data-[slot=bubble-content]:text-primary-950",
        secondary:
          "*:data-[slot=bubble-content]:bg-base-100 *:data-[slot=bubble-content]:text-base-800",
        muted:
          "*:data-[slot=bubble-content]:bg-base-50 *:data-[slot=bubble-content]:text-base-800",
        tinted:
          "*:data-[slot=bubble-content]:bg-primary-50 *:data-[slot=bubble-content]:text-primary-900",
        outline:
          "*:data-[slot=bubble-content]:border-base-700/15 *:data-[slot=bubble-content]:text-base-800 *:data-[slot=bubble-content]:bg-white",
        ghost:
          "*:data-[slot=bubble-content]:text-base-800 *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
        destructive:
          "*:data-[slot=bubble-content]:bg-destructive-50 *:data-[slot=bubble-content]:text-destructive-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end"
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  )
}

function BubbleContent({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "[button,a]:focus-visible:ring-primary-500 w-fit max-w-full min-w-0 overflow-hidden rounded-xl border border-transparent px-4 py-4 font-sans text-base leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap group-data-[align=end]/bubble:self-end group-data-[align=end]/bubble:rounded-br-none [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:ring-2 [button,a]:focus-visible:ring-offset-4 [button,a]:focus-visible:ring-offset-white",
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "bubble-content",
    },
  })
}

const bubbleReactionsVariants = cva(
  "bg-base-100 absolute z-10 flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-sm ring-3 ring-white has-[button]:p-0",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-3/4",
        bottom: "bottom-0 translate-y-3/4",
      },
      align: {
        start: "left-3",
        end: "right-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  },
)

function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end"
  side?: "top" | "bottom"
}) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  )
}

export { Bubble, BubbleContent, BubbleGroup, BubbleReactions }
