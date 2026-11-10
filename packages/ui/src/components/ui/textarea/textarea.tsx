import { cn } from "cn"
import type * as React from "react"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "text-base-800 outline-base-700/15 placeholder:text-base-500 focus-visible:ring-primary-400 aria-invalid:ring-destructive-500 aria-invalid:focus-visible:ring-destructive-500 field-sizing-content min-h-16 w-full min-w-0 resize-y rounded-md bg-white px-2.5 py-2 font-sans text-sm leading-5 font-medium shadow-[0_1px_3px_#0000001a,0_1px_2px_-1px_#0000001a] outline-1 focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-offset-4 aria-invalid:ring-offset-white forced-colors:focus-visible:outline-2",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
