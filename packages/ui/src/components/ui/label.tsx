"use client"

import { Field } from "@base-ui/react/field"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/label.md

// Plain text: no box, no states, no transition. Focus and disabled styling
// belong to the control, and labels wrap instead of truncating.
const labelVariants = cva("", {
  variants: {
    variant: {
      // Settings rows: beside a select or switch, above helper text
      default:
        "text-primary block w-fit cursor-auto text-sm leading-5 font-medium",
      // Account profile: a block above its input
      compact: "text-secondary block cursor-default text-xs leading-4",
    },
  },
  defaultVariants: { variant: "default" },
})

// Field.Label ties the label to its Field.Control. For button-like controls
// (select triggers, switches) pass `nativeLabel={false}` with a non-label
// `render`, so hovering or clicking the label does not reach the button.
function Label({
  className,
  variant,
  ...props
}: Field.Label.Props & VariantProps<typeof labelVariants>) {
  return (
    <Field.Label
      data-slot="label"
      className={cn(labelVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Label, labelVariants }
