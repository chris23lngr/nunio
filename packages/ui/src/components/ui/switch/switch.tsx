"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={(state) =>
        cn(
          "peer group/switch outline-base-700/15 focus-visible:ring-primary-500 aria-invalid:ring-destructive-500 aria-invalid:focus-visible:ring-destructive-500 data-checked:bg-primary-500 data-checked:outline-primary-500 relative inline-flex shrink-0 items-center rounded-full bg-white px-0.5 shadow-[0_1px_2px_#0000000D] outline-1 outline-offset-0 transition-colors group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-white aria-invalid:ring-2 aria-invalid:ring-offset-4 aria-invalid:ring-offset-white data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-4.5 data-[size=default]:w-8 data-[size=sm]:h-[13px] data-[size=sm]:w-[22px]",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-base-500 pointer-events-none block rounded-full ring-0 transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 data-checked:bg-white group-data-[size=default]/switch:data-checked:translate-x-3.5 group-data-[size=sm]/switch:data-checked:translate-x-2 group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
