"use client"

import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/input.md

// Shared by Input and InputGroupInput. The placeholder is texPri at 0.375
// opacity, not a tertiary color. Disabled borrows Button's measured 40%.
const inputBaseClass =
  "text-primary placeholder:text-primary min-w-0 cursor-text text-sm leading-5 font-normal outline-hidden placeholder:opacity-[0.375] data-disabled:cursor-not-allowed data-disabled:opacity-40 forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-transparent"

// A standalone field (Settings → "Bevorzugter Name"). Focus swaps the ring
// with no transition. Inside an InputGroup use InputGroupInput instead.
function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input"
      className={(state) =>
        cn(
          inputBaseClass,
          "bg-secondary-translucent h-7 rounded-md px-2.5 py-1 shadow-input focus-visible:shadow-focus-input",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  )
}

export { Input, inputBaseClass }
