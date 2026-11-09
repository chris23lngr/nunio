"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "cn"
import { CheckIcon, MinusIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={(state) =>
        cn(
          "group/checkbox peer outline-base-700/15 focus-visible:ring-primary-500 aria-invalid:ring-destructive-500 aria-invalid:focus-visible:ring-destructive-500 data-checked:bg-primary-400 data-checked:outline-primary-400 data-indeterminate:bg-primary-400 data-indeterminate:outline-primary-400 relative flex size-4 shrink-0 items-center justify-center rounded-sm bg-white text-white shadow-sm outline-1 outline-offset-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-white disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-offset-4 aria-invalid:ring-offset-white data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 forced-colors:focus-visible:outline-2",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0"
      >
        <CheckIcon
          aria-hidden="true"
          className="group-data-indeterminate/checkbox:hidden"
        />
        <MinusIcon
          aria-hidden="true"
          className="hidden group-data-indeterminate/checkbox:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
