"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { AnimatePresence, motion } from "motion/react"
import * as React from "react"
import { useOpenState } from "../../lib/use-open-state.js"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/tooltip.md

const OpenContext = React.createContext(false)

// Default delays for the triggers inside. This deliberately does not render Base
// UI's Provider: that is a delay group, which opens a neighbour's tooltip
// instantly while another is open. Notion always waits the full delay.
const DelayContext = React.createContext({ delay: 180, closeDelay: 0 })

function TooltipProvider({
  delay = 180,
  closeDelay = 0,
  children,
}: {
  delay?: number
  closeDelay?: number
  children?: React.ReactNode
}) {
  const value = React.useMemo(
    () => ({ delay, closeDelay }),
    [delay, closeDelay],
  )
  return <DelayContext value={value}>{children}</DelayContext>
}

// Notion's tooltips never capture the pointer
function Tooltip({
  open: openProp,
  defaultOpen,
  onOpenChange,
  disableHoverablePopup = true,
  ...props
}: TooltipPrimitive.Root.Props) {
  const [open, handleOpenChange] = useOpenState({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  return (
    <OpenContext value={open}>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        disableHoverablePopup={disableHoverablePopup}
        {...props}
      />
    </OpenContext>
  )
}

// 180ms is Notion's default; it uses 435ms on descriptive tooltips ("Teilen") and
// 140ms on the floating AI button
function TooltipTrigger({
  delay: delayProp,
  closeDelay: closeDelayProp,
  ...props
}: TooltipPrimitive.Trigger.Props) {
  const defaults = React.useContext(DelayContext)
  const delay = delayProp ?? defaults.delay
  const closeDelay = closeDelayProp ?? defaults.closeDelay
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

// CSS `ease-out`
const EASE_OUT = [0, 0, 0.58, 1] as const

// The dark chip is Notion's chrome tooltip; the light card sits beside the
// floating AI button. Each has its own placement and enter animation.
const VARIANTS = {
  default: {
    className:
      "bg-accent text-inverse shadow-tooltip rounded-md px-2 py-[5px] text-xs leading-[1.4]",
    placement: { side: "bottom", align: "center", sideOffset: 6 },
    hidden: { opacity: 0 },
    shown: { opacity: 1 },
  },
  card: {
    className:
      "bg-elevated text-primary origin-(--transform-origin) rounded-[10px] px-2.5 py-1.5 text-sm leading-[1.5] shadow-md",
    placement: { side: "top", align: "end", sideOffset: 8 },
    hidden: { opacity: 0, scale: 0.96 },
    shown: { opacity: 1, scale: 1 },
  },
} as const

type TooltipVariant = keyof typeof VARIANTS

const VariantContext = React.createContext<TooltipVariant>("default")

function TooltipContent({
  className,
  variant = "default",
  side,
  align,
  sideOffset,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "align" | "sideOffset"> & {
    variant?: TooltipVariant
  }) {
  const open = React.useContext(OpenContext)
  const {
    className: variantClass,
    placement,
    hidden,
    shown,
  } = VARIANTS[variant]

  return (
    <VariantContext value={variant}>
      <AnimatePresence>
        {open && (
          <TooltipPrimitive.Portal keepMounted>
            <TooltipPrimitive.Positioner
              className="pointer-events-none z-50"
              side={side ?? placement.side}
              align={align ?? placement.align}
              sideOffset={sideOffset ?? placement.sideOffset}
            >
              {/* A `render` in props replaces the motion.div and with it the
                  enter and exit animations */}
              <TooltipPrimitive.Popup
                data-slot="tooltip-content"
                className={cn(
                  "pointer-events-none max-w-75 text-pretty wrap-break-word",
                  variantClass,
                  className,
                )}
                render={
                  <motion.div
                    initial={hidden}
                    animate={shown}
                    exit={hidden}
                    transition={{ duration: 0.05, ease: EASE_OUT }}
                  />
                }
                {...props}
              />
            </TooltipPrimitive.Positioner>
          </TooltipPrimitive.Portal>
        )}
      </AnimatePresence>
    </VariantContext>
  )
}

// A second line in the dark chip ("⌘⌥L"); an inline key chip in the card ("⌘J")
function TooltipShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const variant = React.useContext(VariantContext)
  return (
    <span
      data-slot="tooltip-shortcut"
      className={cn(
        variant === "card"
          ? "bg-secondary text-tertiary ml-1 inline-block rounded-sm px-1 text-xs leading-[1.5] font-medium"
          : "text-inverse-secondary block",
        className,
      )}
      {...props}
    />
  )
}

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipShortcut,
  TooltipTrigger,
}
