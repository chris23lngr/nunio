"use client"

import { cn } from "cn"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"
import * as React from "react"

// Based on the shadcn/ui base-nova InputOTP. A group carries the Input's
// surface, so slots share one outline; the group shows the Input's focus ring
// while one of its slots is active. Mark slots aria-invalid for the error ring.

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "flex items-center gap-2 has-disabled:opacity-50",
        containerClassName,
      )}
      spellCheck={false}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn(
        "outline-base-700/15 flex items-center rounded-md bg-white shadow-sm outline-1",
        "has-data-[active=true]:ring-primary-500 has-data-[active=true]:ring-2 has-data-[active=true]:ring-offset-4 has-data-[active=true]:ring-offset-white forced-colors:has-data-[active=true]:outline-2",
        "has-aria-invalid:ring-destructive-500 has-aria-invalid:has-data-[active=true]:ring-destructive-500 has-aria-invalid:ring-2 has-aria-invalid:ring-offset-4 has-aria-invalid:ring-offset-white",
        className,
      )}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number
}) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        "text-base-800 border-base-700/15 data-[active=true]:bg-base-50 relative flex size-7.5 items-center justify-center border-r font-sans text-sm leading-5 font-medium tabular-nums first:rounded-l-md last:rounded-r-md last:border-r-0",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink bg-base-800 h-4 w-px" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Keep shadcn's separator; an <hr> cannot hold the icon.
    <div
      data-slot="input-otp-separator"
      className="text-base-500 flex items-center [&_svg:not([class*='size-'])]:size-4"
      role="separator"
      {...props}
    >
      <MinusIcon />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot }
