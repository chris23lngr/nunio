"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/checkbox.md

// A 1.5px frame that turns into a blue fill with a white tick. Only the empty
// box tints on hover and press; the fill fades in, the tick snaps.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "data-unchecked:hover:bg-secondary-translucent-150 data-unchecked:active:bg-secondary-translucent-200 data-checked:bg-blue-accent focus-visible:shadow-focus-button inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[1.5px] border-[1.5px] border-(--n-icoPri) outline-hidden transition-[background-color] duration-200 ease-out data-checked:border-0 data-disabled:pointer-events-none data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-3.5 fill-white"
        >
          <path d="M11.62 3.18a.876.876 0 0 1 1.5.9l-5.244 8.74a.876.876 0 0 1-1.414.12L2.966 8.86a.875.875 0 1 1 1.328-1.138L7 10.879z" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
