"use client"

import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"
import type * as React from "react"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "text-base-800 outline-base-700/15 file:text-base-800 placeholder:text-base-500 focus-visible:ring-primary-500 aria-invalid:ring-destructive-500 aria-invalid:focus-visible:ring-destructive-500 h-7.5 w-full min-w-0 rounded-md bg-white px-2.5 py-0 font-sans text-sm font-medium shadow-sm outline-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-white disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-offset-4 aria-invalid:ring-offset-white data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 forced-colors:focus-visible:outline-2",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
