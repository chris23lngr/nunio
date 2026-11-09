"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { PanelLeft } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"

// Spec: docs/notion-spec/components/sidebar.md
// Structure follows shadcn's sidebar (Base UI flavour); Notion's desktop sidebar
// is a docked column that collapses off-canvas, so the mobile sheet, icon and
// floating modes are left out until they can be measured.

const SIDEBAR_WIDTH = "270px"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }
  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (setOpenProp) setOpenProp(value)
      else _setOpen(value)
    },
    [setOpenProp],
  )
  const toggleSidebar = React.useCallback(() => setOpen(!open), [open, setOpen])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  const state = open ? "expanded" : "collapsed"
  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, open, setOpen, toggleSidebar }),
    [state, open, setOpen, toggleSidebar],
  )

  return (
    <SidebarContext value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          { "--sidebar-width": SIDEBAR_WIDTH, ...style } as React.CSSProperties
        }
        className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext>
  )
}

// The outer box reserves layout width and animates it to 0; the panel inside
// keeps its width and slides out while fading, as Notion's does. A collapsed
// panel is inert, and focus inside it moves to a trigger left on the page.
function Sidebar({
  className,
  children,
  "aria-label": label = "Sidebar",
  ...props
}: React.ComponentProps<"div">) {
  const { state } = useSidebar()
  const panelRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const panel = panelRef.current
    if (state !== "collapsed" || !panel?.contains(document.activeElement))
      return
    const wrapper = panel.closest("[data-slot=sidebar-wrapper]")
    const triggers = wrapper?.querySelectorAll<HTMLElement>(
      "[data-slot=sidebar-trigger]",
    )
    const outside = [...(triggers ?? [])].find((t) => !panel.contains(t))
    outside?.focus()
  }, [state])

  return (
    <div
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === "collapsed" ? "offcanvas" : ""}
      className={cn(
        "group peer ease-standard relative h-full w-(--sidebar-width) shrink-0 overflow-hidden transition-[width] duration-200 data-[state=collapsed]:w-0",
        className,
      )}
      {...props}
    >
      <nav
        ref={panelRef}
        aria-label={label}
        inert={state === "collapsed"}
        data-slot="sidebar-inner"
        className="bg-secondary text-primary ease-standard flex h-full w-(--sidebar-width) flex-col shadow-[inset_-1px_0_0_0_var(--border-color-secondary)] transition-[opacity,translate] duration-200 group-data-[state=collapsed]:-translate-x-[250px] group-data-[state=collapsed]:opacity-0"
      >
        {children}
      </nav>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      size="icon"
      className={cn(
        "[&_svg:not([class*='text-'])]:text-icon-secondary",
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeft />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex shrink-0 flex-col", className)}
      {...props}
    />
  )
}

// Stays below the scroll region
function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex shrink-0 flex-col", className)}
      {...props}
    />
  )
}

// The scroll region: 8px gutters, 12px between groups
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-2 pt-1.5",
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

// A section header ("Privat"). Render it as a Collapsible.Trigger to make the
// section collapsible: it then fills on hover and shows its chevron, rotated
// -90deg while closed. Pass the chevron as an svg child.
function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "peer/group-label text-tertiary flex h-[30px] w-full shrink-0 items-center gap-1 rounded-md px-2 text-left text-xs leading-4 font-medium outline-hidden",
          "[&>svg]:text-icon-tertiary [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:-rotate-90 [&>svg]:opacity-0 data-panel-open:[&>svg]:rotate-0",
          "[button&]:hover:bg-interactive-translucent [button&]:hover:text-accent [button&]:active:bg-interactive-translucent-200 [button&]:cursor-pointer [button&]:hover:[&>svg]:opacity-100",
          "focus-visible:bg-interactive-translucent focus-visible:text-accent focus-visible:shadow-focus-button focus-visible:[&>svg]:opacity-100",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "sidebar-group-label", sidebar: "group-label" },
  })
}

const actionClass =
  "text-icon-secondary hover:bg-interactive-translucent active:bg-interactive-translucent-200 focus-visible:shadow-focus-button absolute top-[5px] right-1.5 flex size-5 cursor-pointer items-center justify-center rounded outline-hidden [&>svg]:size-4 [&>svg]:shrink-0"

// Section actions ("add page") appear while the header is hovered or focused
function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          actionClass,
          "opacity-0 peer-hover/group-label:opacity-100 peer-focus-visible/group-label:opacity-100 hover:opacity-100 focus-visible:opacity-100",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "sidebar-group-action", sidebar: "group-action" },
  })
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-px", className)}
      {...props}
    />
  )
}

// Notion paints row hover on the outer row and the current page on the inner
// button, so a hovered current page shows both layers
function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn(
        "group/menu-item hover:bg-interactive-translucent relative rounded-md",
        // Revealed actions take room from the label, as in Notion (246 → 219px)
        "[&:has(>[data-slot=sidebar-menu-action]):is(:hover,:focus-within)>[data-slot=sidebar-menu-button]]:pr-8",
        className,
      )}
      {...props}
    />
  )
}

// Icons default to Notion's 18px page glyph in a 22px slot; give navigation
// icons `size-[22px]` to fill the slot
const sidebarMenuButtonVariants = cva(
  "peer/menu-button data-active:bg-interactive-translucent data-active:text-primary focus-visible:bg-interactive-translucent active:bg-interactive-translucent-200 focus-visible:shadow-focus-button flex h-[30px] w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-[5px] text-left text-sm leading-[21px] font-normal outline-hidden select-none disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:shrink-0 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:mx-0.5 [&>svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "text-accent [&>svg:not([class*='text-'])]:text-icon-secondary",
        // "Seitenleiste anpassen"
        muted: "text-tertiary [&>svg:not([class*='text-'])]:text-icon-tertiary",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      { className: cn(sidebarMenuButtonVariants({ variant }), className) },
      props,
    ),
    render,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      active: isActive,
    },
  })
}

// Trailing row controls ("•••", add). A sibling of the button rather than
// nested in it, unlike Notion, so each stays its own focus stop.
function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    showOnHover?: boolean
  }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          actionClass,
          showOnHover &&
            "opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 aria-expanded:opacity-100",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "sidebar-menu-action", sidebar: "menu-action" },
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
