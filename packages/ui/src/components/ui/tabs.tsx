"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import * as React from "react"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/tabs.md

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

const listVariants = cva("flex items-center", {
  variants: {
    variant: {
      // Library view tabs: 32px pills in a 40px strip
      view: "h-10 gap-px overflow-hidden",
      // Sidebar Home / Chat / Meetings
      sidebar: "h-8 flex-nowrap gap-0.5 pl-[3px]",
    },
  },
  defaultVariants: { variant: "view" },
})

type TabsVariant = NonNullable<VariantProps<typeof listVariants>["variant"]>

const VariantContext = React.createContext<TabsVariant>("view")

function TabsList({
  className,
  variant = "view",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof listVariants>) {
  return (
    <VariantContext value={variant ?? "view"}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(listVariants({ variant }), className)}
        {...props}
      />
    </VariantContext>
  )
}

// Fills follow Notion's derived bacIntTra states: hover 1×, active hover 1.5×,
// pressed 2×. No sliding indicator: the active tab paints its own background.
const tabVariants = cva(
  "hover:bg-interactive-translucent focus-visible:bg-interactive-translucent data-active:bg-interactive-translucent data-active:hover:bg-interactive-translucent-150 data-active:focus-visible:bg-interactive-translucent-150 active:bg-interactive-translucent-200 text-secondary data-active:text-primary focus-visible:shadow-focus-button flex h-8 min-w-0 shrink-0 cursor-pointer items-center text-sm leading-[1.2] font-medium whitespace-nowrap outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-40",
  {
    variants: {
      variant: {
        view: "max-w-[220px] rounded-[20px] px-3 py-1.5 transition-[background-color] duration-100 ease-in-out [&_svg]:mr-1.5 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
        // Icon-only until active; then the label opens and the tab gains
        // trailing room. Background changes snap, layout eases out.
        sidebar:
          "justify-center rounded-lg px-[5px] transition-[padding,margin] duration-200 ease-out data-active:mx-1 data-active:pr-0 data-active:first:ml-0",
      },
    },
    defaultVariants: { variant: "view" },
  },
)

type TabsTabProps = TabsPrimitive.Tab.Props & { icon?: React.ReactNode }

function TabsTab({ className, icon, children, ...props }: TabsTabProps) {
  const variant = React.useContext(VariantContext)

  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(tabVariants({ variant }), className)}
      {...props}
    >
      {variant === "sidebar" ? (
        <>
          {/* Notion masks a #55534e glyph; icoPri is its nearest token and
              flips with the theme */}
          <span
            data-slot="tabs-tab-icon"
            className="text-icon-primary flex size-[22px] shrink-0 items-center justify-center opacity-50 in-data-active:opacity-100 [&_svg:not([class*='size-'])]:size-5"
          >
            {icon}
          </span>
          <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out in-data-active:grid-cols-[1fr]">
            <span className="overflow-hidden">
              <span className="block mask-[linear-gradient(to_right,black_calc(100%-8px),transparent)] pr-2 pl-1.5">
                {children}
              </span>
            </span>
          </span>
        </>
      ) : (
        <>
          {icon}
          <span className="mt-px min-w-0 truncate">{children}</span>
        </>
      )}
    </TabsPrimitive.Tab>
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-hidden", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsPanel, TabsTab }
