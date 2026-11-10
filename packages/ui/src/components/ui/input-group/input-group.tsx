"use client"

import { cn } from "cn"
import type * as React from "react"
import { Button } from "../button/button.js"
import { Input } from "../input/input.js"
import { Textarea } from "../textarea/textarea.js"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: A single composed field uses group semantics, not fieldset semantics.
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group text-base-800 outline-base-700/15 relative flex h-7.5 w-full min-w-0 items-center gap-2 rounded-md bg-white px-2.5 font-sans text-sm leading-5 font-medium shadow-[0_1px_3px_#0000001a,0_1px_2px_-1px_#0000001a] outline-1",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-primary-400 has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-offset-4 has-[[data-slot=input-group-control]:focus-visible]:ring-offset-white forced-colors:has-[[data-slot=input-group-control]:focus-visible]:outline-2",
        "has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive-500 has-[[data-slot=input-group-control][aria-invalid=true]:focus-visible]:ring-destructive-500 has-[[data-slot=input-group-control][aria-invalid=true]]:ring-2 has-[[data-slot=input-group-control][aria-invalid=true]]:ring-offset-4 has-[[data-slot=input-group-control][aria-invalid=true]]:ring-offset-white",
        "has-[[data-slot=input-group-control]:disabled]:cursor-not-allowed has-[[data-slot=input-group-control]:disabled]:opacity-50 has-[[data-slot=input-group-control]:disabled]:[&_[data-slot=input-group-button]]:opacity-100",
        "has-[>[data-align^=block]]:h-auto has-[>[data-align^=block]]:flex-col has-[>[data-align^=block]]:items-stretch has-[>[data-align^=block]]:gap-0 has-[>[data-align^=block]]:px-0 has-[>textarea]:h-auto has-[>textarea]:flex-col has-[>textarea]:items-stretch has-[>textarea]:gap-0 has-[>textarea]:px-0",
        "[&:has(>[data-align^=block])>input]:h-7.5 [&:has(>[data-align^=block])>input]:flex-none [&:has(>[data-align^=block])>input]:px-2.5",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupAddon({
  className,
  align = "inline-start",
  onClick,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "inline-start" | "inline-end" | "block-start" | "block-end"
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: This groups adornments within a single field.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Pointer shortcut to the separately keyboard-focusable control.
    <div
      data-slot="input-group-addon"
      data-align={align}
      role="group"
      className={cn(
        "text-base-500 flex shrink-0 cursor-text items-center justify-center gap-2 text-sm leading-5 font-medium [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        align.endsWith("start") ? "order-first" : "order-last",
        align === "block-end" && "min-h-10 w-full justify-start px-2 py-1.5",
        align === "block-start" &&
          "min-h-7.5 w-full justify-start px-2.5 pt-2 pb-0.5",
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented ||
          (event.target as Element).closest("button, a, [role=button]")
        )
          return
        event.currentTarget.parentElement
          ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            "[data-slot=input-group-control]",
          )
          ?.focus()
      }}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent shadow-none ring-0 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-100 aria-invalid:ring-0 aria-invalid:ring-offset-0 aria-invalid:focus-visible:ring-0",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-text"
      className={cn(
        "text-base-500 flex items-center gap-2 text-sm leading-5 font-medium",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupButton({
  type = "button",
  variant = "ghost",
  size = "sm",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="input-group-button"
      type={type}
      variant={variant}
      size={size}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "h-full flex-1 rounded-none border-0 bg-transparent p-0 shadow-none ring-0 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-100 aria-invalid:ring-0 aria-invalid:ring-offset-0 aria-invalid:focus-visible:ring-0 data-disabled:opacity-100",
        className,
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
}
