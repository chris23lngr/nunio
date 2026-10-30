"use client"

import * as React from "react"

// Base UI popups take `open` either controlled or uncontrolled, but Motion's
// AnimatePresence needs to know it either way. This owns the uncontrolled state
// and reports changes to the caller, so wrappers can always pass `open` down.
export function useOpenState<Details>({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean | undefined
  defaultOpen?: boolean | undefined
  onOpenChange?: ((open: boolean, details: Details) => void) | undefined
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const handleOpenChange = (next: boolean, details: Details) => {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next, details)
  }
  return [open, handleOpenChange] as const
}
