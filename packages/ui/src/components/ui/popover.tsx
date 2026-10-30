"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { AnimatePresence, motion } from "motion/react"
import * as React from "react"
import { useOpenState } from "../../lib/use-open-state.js"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/popover.md

const OpenContext = React.createContext(false)

// Notion's popovers are modal dialogs: a transparent backdrop swallows the first
// outside click, which only closes
function Popover({
  open: openProp,
  defaultOpen,
  onOpenChange,
  modal = true,
  ...props
}: PopoverPrimitive.Root.Props) {
  const [open, handleOpenChange] = useOpenState({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  return (
    <OpenContext value={open}>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        modal={modal}
        {...props}
      />
    </OpenContext>
  )
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

// CSS `ease`, shared with Notion's menus
const EASE = [0.25, 0.1, 0.25, 1] as const
const HIDDEN = { opacity: 0, scale: 0.96 }
const SHOWN = { opacity: 1, scale: 1 }

type PopoverContentProps = PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >

// The frame only: width is set per surface ("Teilen" is 456px) and content
// brings its own padding
function PopoverContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  alignOffset,
  anchor,
  ...props
}: PopoverContentProps) {
  const open = React.useContext(OpenContext)

  return (
    <AnimatePresence>
      {open && (
        <PopoverPrimitive.Portal keepMounted>
          <PopoverPrimitive.Positioner
            className="z-50 outline-hidden"
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            anchor={anchor}
            collisionPadding={12}
          >
            {/* A `render` in props replaces the motion.div and with it the
                enter and exit animations */}
            <PopoverPrimitive.Popup
              data-slot="popover-content"
              className={cn(
                "bg-popover text-primary origin-(--transform-origin) overflow-hidden rounded-xl shadow-lg outline-hidden",
                "max-h-[min(90vh,var(--available-height))] max-w-[calc(100vw-24px)] min-w-45",
                className,
              )}
              render={
                <motion.div
                  initial={HIDDEN}
                  animate={SHOWN}
                  exit={HIDDEN}
                  transition={{ duration: 0.2, ease: EASE }}
                />
              }
              {...props}
            />
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

// Notion's popovers have no visible title; these name and describe the dialog
// and are styled by the caller
function PopoverTitle(props: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" {...props} />
}

function PopoverDescription(props: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description data-slot="popover-description" {...props} />
  )
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
}
