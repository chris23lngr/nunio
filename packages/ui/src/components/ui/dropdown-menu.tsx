"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cva, type VariantProps } from "class-variance-authority"
import { Check, ChevronRight, Search } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import * as React from "react"
import { useOpenState } from "../../lib/use-open-state.js"
import { cn } from "../../lib/utils.js"
import { switchThumbClass, switchTrackClass } from "./switch.js"

// Spec: docs/notion-spec/components/dropdown-menu.md

// Motion needs the open state to drive AnimatePresence, so roots own it and share it
// with their content. Submenus provide their own value, shadowing the root's.
const OpenContext = React.createContext(false)

type DropdownMenuProps = MenuPrimitive.Root.Props & {
  // Filter items with a DropdownMenuSearch input, like Notion's page menu
  searchable?: boolean
}

function DropdownMenu({
  open: openProp,
  defaultOpen,
  onOpenChange,
  searchable = false,
  ...props
}: DropdownMenuProps) {
  const [open, handleOpenChange] = useOpenState({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  const root = (
    <OpenContext value={open}>
      <MenuPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </OpenContext>
  )
  return searchable ? (
    <MenuPrimitive.FilterProvider>{root}</MenuPrimitive.FilterProvider>
  ) : (
    root
  )
}

function DropdownMenuSub({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: MenuPrimitive.SubmenuRoot.Props) {
  const [open, handleOpenChange] = useOpenState({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  return (
    <OpenContext value={open}>
      <MenuPrimitive.SubmenuRoot
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </OpenContext>
  )
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

// CSS `ease`, Notion's curve for every menu transition
const EASE = [0.25, 0.1, 0.25, 1] as const

// Menus anchored to a trigger scale in; submenus and menus opened at a pointer
// (pass `anchor`) only fade
const ANIMATIONS = {
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    shown: { opacity: 1, scale: 1 },
  },
  fade: { hidden: { opacity: 0 }, shown: { opacity: 1 } },
}

type DropdownMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    | "side"
    | "align"
    | "sideOffset"
    | "alignOffset"
    | "anchor"
    | "collisionPadding"
  > & {
    animation?: keyof typeof ANIMATIONS
  }

function DropdownMenuContent({
  className,
  onKeyDown,
  onPointerMove,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  alignOffset,
  anchor,
  collisionPadding = 12,
  animation = "scale",
  ...props
}: DropdownMenuContentProps) {
  const open = React.useContext(OpenContext)
  const { hidden, shown } = ANIMATIONS[animation]

  return (
    <AnimatePresence>
      {open && (
        <MenuPrimitive.Portal keepMounted>
          <MenuPrimitive.Positioner
            className="z-50 outline-hidden"
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            anchor={anchor}
            collisionPadding={collisionPadding}
          >
            {/* A `render` in props replaces the motion.div and with it the
                enter and exit animations */}
            <MenuPrimitive.Popup
              data-slot="dropdown-menu-content"
              className={cn(
                "bg-popover text-primary w-64 origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-[10px] shadow-lg outline-hidden",
                "max-h-[min(80vh,var(--available-height))]",
                // With a list, only the list scrolls; search and footer stay put
                "has-data-[slot=dropdown-menu-list]:flex has-data-[slot=dropdown-menu-list]:flex-col has-data-[slot=dropdown-menu-list]:overflow-hidden",
                className,
              )}
              render={
                <motion.div
                  initial={hidden}
                  animate={shown}
                  exit={hidden}
                  transition={{ duration: 0.2, ease: EASE }}
                />
              }
              // Notion rings a highlighted item only when the highlight came from
              // the keyboard. Base UI has one highlight for both, so the popup
              // records the last input modality; items read it with
              // `in-data-[nav=keyboard]`.
              onKeyDown={(event) => {
                event.currentTarget.dataset.nav = "keyboard"
                onKeyDown?.(event)
              }}
              onPointerMove={(event) => {
                event.currentTarget.dataset.nav = "pointer"
                onPointerMove?.(event)
              }}
              {...props}
            />
          </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

const groupClass = "flex flex-col gap-px p-1"

function DropdownMenuGroup({ className, ...props }: MenuPrimitive.Group.Props) {
  return (
    <MenuPrimitive.Group
      data-slot="dropdown-menu-group"
      className={cn(groupClass, className)}
      {...props}
    />
  )
}

// Icon size and color only apply to icons without their own size or color class.
// Notion draws ~15px filled glyphs in a 20px box; 16px Lucide icons match that
// visually, and leading icons get 2px margins to keep the 20px slot.
const itemVariants = cva(
  "text-primary data-highlighted:bg-interactive-translucent active:bg-interactive-translucent-200 [&_svg:not([class*='text-'])]:text-icon-primary flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm leading-[1.2] outline-hidden transition-[background-color] duration-[20ms] ease-in select-none data-disabled:pointer-events-none data-disabled:opacity-40 in-data-[nav=keyboard]:data-highlighted:shadow-focus-button [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>svg:not([data-slot])]:mx-0.5",
  {
    variants: {
      variant: {
        default: "",
        // "Neuer Workspace", "Upgrade durchführen"
        accent:
          "text-blue-accent [&_svg:not([class*='text-'])]:text-blue-accent leading-5 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function DropdownMenuItem({
  className,
  variant,
  ...props
}: MenuPrimitive.Item.Props & VariantProps<typeof itemVariants>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(itemVariants({ variant }), className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("text-tertiary ml-auto pl-2 text-xs", className)}
      {...props}
    />
  )
}

// 10px above the label text (4px group padding + 6px) and 10px to the first row
// (9px + the group's 1px gap)
function DropdownMenuLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn(
        "text-secondary truncate px-2 pt-1.5 pb-[9px] text-xs leading-[1.2] font-medium",
        className,
      )}
      {...props}
    />
  )
}

// Notion's checkbox rows use a Switch; until nui has one, both checkbox and radio
// items show the trailing check from the workspace switcher
function ItemCheck() {
  return (
    <Check
      data-slot="dropdown-menu-indicator"
      className="text-primary mr-0.5 ml-auto size-4"
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemVariants(), className)}
      {...props}
    >
      {children}
      {/* Notion's toggle rows ("Kleiner Text") end in a switch, shown on and
          off; the row is the control, so this is only the switch's visual */}
      <MenuPrimitive.CheckboxItemIndicator
        keepMounted
        data-slot="dropdown-menu-indicator"
        className="ml-auto h-[18px] w-[30px] shrink-0"
      >
        <span data-slot="switch-track" className={switchTrackClass}>
          <span className={switchThumbClass} />
        </span>
      </MenuPrimitive.CheckboxItemIndicator>
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  className,
  ...props
}: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      className={cn(groupClass, className)}
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemVariants(), className)}
      {...props}
    >
      {children}
      <MenuPrimitive.RadioItemIndicator render={<ItemCheck />} />
    </MenuPrimitive.RadioItem>
  )
}

// Notion's "Zuletzt bearbeitet / name / date" block below the items
function DropdownMenuFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-footer"
      className={cn(
        "text-tertiary flex flex-col gap-0.5 px-3 py-2 text-xs leading-4 [&>:first-child]:font-medium",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-tertiary-translucent mx-3 h-px shrink-0", className)}
      {...props}
    />
  )
}

// Requires <DropdownMenu searchable>; `className` styles the wrapper, other props
// go to the input
function DropdownMenuSearch({
  className,
  ...props
}: MenuPrimitive.Input.Props) {
  return (
    <div
      data-slot="dropdown-menu-search"
      className={cn("shrink-0 px-3 pt-3 pb-2", className)}
    >
      <div className="bg-secondary-translucent flex h-7 cursor-text items-center gap-1.5 rounded-md px-1.5 py-[3px] shadow-input focus-within:shadow-focus-input">
        <Search className="text-icon-tertiary size-4 shrink-0" />
        <MenuPrimitive.Input
          className="text-primary placeholder:text-tertiary min-w-0 flex-1 bg-transparent text-sm leading-5 outline-hidden"
          {...props}
        />
      </div>
    </div>
  )
}

function DropdownMenuEmpty({ className, ...props }: MenuPrimitive.Empty.Props) {
  return (
    <MenuPrimitive.Empty
      data-slot="dropdown-menu-empty"
      className={cn("text-secondary px-3 py-1.5 text-sm", className)}
      {...props}
    />
  )
}

function DropdownMenuList({ className, ...props }: MenuPrimitive.List.Props) {
  return (
    <MenuPrimitive.List
      data-slot="dropdown-menu-list"
      className={cn("min-h-0 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  delay = 170,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      delay={delay}
      className={cn(
        itemVariants(),
        "data-popup-open:bg-interactive-translucent",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight
        data-slot="dropdown-menu-indicator"
        className="text-icon-secondary ml-auto size-4"
      />
    </MenuPrimitive.SubmenuTrigger>
  )
}

// Submenus open beside their trigger row, centred on it, and only fade
function DropdownMenuSubContent({
  className,
  side = "inline-end",
  align = "center",
  sideOffset = 0,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuContent
      className={cn("w-75", className)}
      side={side}
      align={align}
      sideOffset={sideOffset}
      animation="fade"
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFooter,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuList,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
