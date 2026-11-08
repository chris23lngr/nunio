"use client"

import { Input as InputPrimitive } from "@base-ui/react/input"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"
import { inputBaseClass } from "./input.js"

// Spec: docs/notion-spec/components/input.md

// The frame owns the surface; its control is bare text. Only the control's
// focus rings the frame, so a focused InputGroupButton leaves it idle.
const inputGroupVariants = cva(
  "group/input-group [&_svg:not([class*='text-'])]:text-icon-secondary has-[[data-slot=input-group-control]:focus-visible]:shadow-focus-input relative flex w-full min-w-0 cursor-text items-center gap-1.5 rounded-md [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Page menu search
        default: "bg-secondary-translucent shadow-input h-7 px-1.5 py-[3px]",
        // Settings search: the same field with an inset ring and lighter icon
        inset:
          "bg-secondary-translucent [&_svg:not([class*='text-'])]:text-icon-tertiary shadow-input-inset h-7 px-1.5 py-1",
        // Share recipients: transparent, grows with chips
        outline:
          "shadow-input min-h-8 bg-transparent px-1 py-0.5 *:data-[slot=input-group-control]:h-6 *:data-[slot=input-group-control]:p-0.5",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function InputGroup({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupVariants>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend semantics to a single field
    <div
      data-slot="input-group"
      role="group"
      className={cn(inputGroupVariants({ variant }), className)}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex cursor-text items-center justify-center select-none",
  {
    variants: {
      align: {
        "inline-start": "order-first",
        "inline-end": "order-last",
      },
    },
    defaultVariants: { align: "inline-start" },
  },
)

// Clicking an icon or text addon focuses the input, like Notion's frame
function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: groups the addon content, as in shadcn
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut to the input, which is focusable itself
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

function InputGroupButton({
  variant = "ghost",
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="input-group-button"
      variant={variant}
      size={size}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-text"
      className={cn(
        "text-tertiary flex items-center gap-1.5 text-sm [&_svg]:pointer-events-none",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupInput({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input-group-control"
      className={(state) =>
        cn(
          inputBaseClass,
          "h-5 flex-1 bg-transparent p-0",
          typeof className === "function" ? className(state) : className,
        )
      }
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
  inputGroupVariants,
}
