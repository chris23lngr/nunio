"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/command.md

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"])

// Notion keeps pointer hover apart from the selection: hovering a row tints it
// but leaves the keyboard selection where it was, so pointer selection is off
// by default and hover is styled on its own.
function Command({
  className,
  disablePointerSelection = true,
  onKeyDown,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      disablePointerSelection={disablePointerSelection}
      className={cn(
        "text-primary flex size-full flex-col overflow-hidden text-base leading-6 outline-hidden",
        className,
      )}
      // The selected row gains the focus ring once the keyboard has moved the
      // selection. Focus stays in the input, so `:focus-visible` cannot tell;
      // the root records it for `in-data-[nav=keyboard]`.
      onKeyDown={(event) => {
        const vim = event.ctrlKey && ["n", "p", "j", "k"].includes(event.key)
        if (NAV_KEYS.has(event.key) || vim)
          event.currentTarget.dataset.nav = "keyboard"
        onKeyDown?.(event)
      }}
      onPointerDown={(event) => {
        event.currentTarget.dataset.nav = "pointer"
        onPointerDown?.(event)
      }}
      {...props}
    />
  )
}

type CommandDialogProps = Omit<DialogPrimitive.Root.Props, "children"> & {
  title?: string
  description?: string
  className?: string
  children?: React.ReactNode
}

// The frosted ⌘K surface: centred, its top at 9vh, sized like Notion's
// (1006 wide, viewport height minus 9vh and 16px). Notion's overlay is
// transparent and both open and close snap, so nothing animates.
function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run…",
  className,
  children,
  ...props
}: CommandDialogProps) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="command-dialog-backdrop"
          className="fixed inset-0 z-50"
        />
        <DialogPrimitive.Popup
          data-slot="command-dialog"
          className={cn(
            "bg-popover-frosted text-primary fixed top-[9vh] left-1/2 z-50 flex h-[calc(91vh-16px)] w-[1006px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[20px] shadow-screen outline-hidden backdrop-blur-[40px]",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// Borderless 16/24 input; the icon sits 16px from the edge and the text 12px
// after it
function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-12 shrink-0 items-center gap-3 px-4"
    >
      <Search className="text-icon-secondary size-[22px] shrink-0" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "text-primary placeholder:text-primary h-6 min-w-0 flex-1 bg-transparent p-0 text-base leading-6 outline-hidden placeholder:opacity-[0.375] disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        {...props}
      />
    </div>
  )
}

// Fills the space between input and footer and scrolls; the sizer is a column so
// Empty can centre itself in it
function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "min-h-0 flex-1 scroll-py-1 overflow-y-auto overscroll-contain px-2.5 outline-hidden [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:min-h-full [&>[cmdk-list-sizer]]:flex-col",
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn(
        "text-secondary flex min-h-24 flex-1 flex-col items-center justify-center text-center text-sm leading-5 font-medium",
        className,
      )}
      {...props}
    />
  )
}

function CommandLoading({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Loading>) {
  return (
    <CommandPrimitive.Loading
      data-slot="command-loading"
      className={cn("text-secondary px-2 py-1.5 text-sm", className)}
      {...props}
    />
  )
}

// 6px above the heading (with the group's 4px padding, 10px from the group's
// top) and 8px to the first row; rows sit 1px apart
function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "[&_[cmdk-group-heading]]:text-secondary p-1 [&_[cmdk-group-heading]]:mt-1.5 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:truncate [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:leading-[14.4px] [&_[cmdk-group-heading]]:font-medium [&>[cmdk-group-items]]:flex [&>[cmdk-group-items]]:flex-col [&>[cmdk-group-items]]:gap-px",
        className,
      )}
      {...props}
    />
  )
}

// Notion separates groups with spacing only; this matches the footer's rule
function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("border-secondary-translucent my-1 border-t", className)}
      {...props}
    />
  )
}

// 36px one-line rows; a second line grows the row. An 18px icon plus a 10px
// gap puts the label 28px in, where Notion's 20px icon box and 8px gap put it.
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "text-primary hover:bg-interactive-translucent data-[selected=true]:bg-interactive-translucent active:bg-interactive-translucent-200 [&_svg:not([class*='text-'])]:text-icon-secondary relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1 text-sm leading-5 font-medium outline-hidden transition-[background-color] duration-[20ms] ease-in select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40 in-data-[nav=keyboard]:data-[selected=true]:shadow-focus-button [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "text-tertiary ml-auto pl-2 text-xs leading-[18px] font-normal",
        className,
      )}
      {...props}
    />
  )
}

// Notion's hint bar: key glyphs and a hint on the left, actions on the right
function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        "border-secondary-translucent text-tertiary [&_svg:not([class*='text-'])]:text-icon-secondary flex h-[41px] shrink-0 items-center gap-1.5 border-t py-2 pr-3 pl-4 text-xs leading-[18px] [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut,
}
