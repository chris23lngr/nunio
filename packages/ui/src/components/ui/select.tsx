"use client"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import * as React from "react"
import { useOpenState } from "../../lib/use-open-state.js"
import { cn } from "../../lib/utils.js"
import { labelVariants } from "./label.js"

// Spec: docs/notion-spec/components/select.md

const OpenContext = React.createContext(false)

function Select<Value, Multiple extends boolean | undefined = false>({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  const [open, handleOpenChange] = useOpenState({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  return (
    <OpenContext value={open}>
      <SelectPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </OpenContext>
  )
}

function SelectLabel({ className, ...props }: SelectPrimitive.Label.Props) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(labelVariants(), className)}
      {...props}
    />
  )
}

// Outlined and as wide as its value. Notion's chevron is a narrow 14px-high
// glyph; a 14px Lucide chevron draws the same visual size.
function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "border-primary-translucent text-primary hover:bg-interactive-translucent focus-visible:bg-interactive-translucent data-popup-open:bg-interactive-translucent active:bg-interactive-translucent-150 focus-visible:shadow-focus-button inline-flex h-7 w-fit cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 text-sm leading-[1.2] font-medium whitespace-nowrap outline-hidden transition-[background-color] duration-[20ms] ease-in select-none data-disabled:cursor-default data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        data-slot="select-icon"
        render={
          <ChevronDown className="text-icon-secondary size-3.5 shrink-0" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className="truncate"
      {...props}
    />
  )
}

// CSS `ease`, shared with Notion's menus and popovers
const EASE = [0.25, 0.1, 0.25, 1] as const
const HIDDEN = { opacity: 0, scale: 0.96 }
const SHOWN = { opacity: 1, scale: 1 }

type SelectContentProps = SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "alignItemWithTrigger"
  >

// A separate popup below the trigger: Notion never overlaps the trigger the way
// Base UI's default `alignItemWithTrigger` does
function SelectContent({
  className,
  children,
  onKeyDown,
  onPointerMove,
  side = "bottom",
  align = "end",
  sideOffset = 4,
  alignOffset,
  alignItemWithTrigger = false,
  ...props
}: SelectContentProps) {
  const open = React.useContext(OpenContext)

  return (
    <AnimatePresence>
      {open && (
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            className="z-50 outline-hidden"
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            alignItemWithTrigger={alignItemWithTrigger}
            collisionPadding={12}
          >
            {/* A `render` in props replaces the motion.div and with it the
                enter and exit animations */}
            <SelectPrimitive.Popup
              data-slot="select-content"
              className={cn(
                "bg-popover text-primary flex w-[250px] max-w-[calc(100vw-24px)] min-w-45 origin-(--transform-origin) flex-col overflow-hidden rounded-[10px] shadow-lg outline-hidden",
                "max-h-[min(400px,var(--available-height))]",
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
              // Same keyboard-only ring as the menu: the popup records the last
              // input modality and items read it with `in-data-[nav=keyboard]`
              onKeyDown={(event) => {
                event.currentTarget.dataset.nav = "keyboard"
                onKeyDown?.(event)
              }}
              onPointerMove={(event) => {
                event.currentTarget.dataset.nav = "pointer"
                onPointerMove?.(event)
              }}
              {...props}
            >
              <SelectPrimitive.List
                data-slot="select-list"
                className="flex flex-col gap-px overflow-y-auto overscroll-contain p-1"
              >
                {children}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "text-primary data-highlighted:bg-interactive-translucent active:bg-interactive-translucent-200 in-data-[nav=keyboard]:data-highlighted:shadow-focus-button flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm leading-[1.2] outline-hidden transition-[background-color] duration-[20ms] ease-in select-none data-disabled:pointer-events-none data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        render={<Check className="text-primary size-4 shrink-0" />}
      />
    </SelectPrimitive.Item>
  )
}

export {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
}
