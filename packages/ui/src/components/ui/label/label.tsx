"use client"

import { Field } from "@base-ui/react/field"
import { cn } from "cn"

function Label({ className, ...props }: Field.Label.Props) {
  return (
    <Field.Label
      data-slot="label"
      className={(state) =>
        cn(
          "text-base-800 data-invalid:text-destructive-700 block w-fit max-w-full font-sans text-sm font-medium data-disabled:opacity-50",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  )
}

export { Label }
