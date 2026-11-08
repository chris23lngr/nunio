"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/switch.md

// The visible pill and thumb. Menus reuse them for checkbox rows, where the row
// is the control; both react to `data-checked` on any ancestor.
const switchTrackClass =
  "bg-switch in-data-checked:bg-blue-accent flex size-full rounded-full p-0.5 transition-[background-color,box-shadow] duration-200 ease-standard"
const switchThumbClass =
  "in-data-checked:translate-x-3 size-3.5 rounded-full bg-white transition-[translate,background-color] duration-200 ease-out"

// Notion tints a round layer behind the translucent track on hover and press,
// and rings that layer on keyboard focus
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "hover:bg-secondary-translucent-150 active:bg-secondary-translucent-200 focus-visible:shadow-focus-button relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full outline-hidden data-disabled:pointer-events-none data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <span data-slot="switch-track" className={switchTrackClass}>
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={switchThumbClass}
        />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch, switchThumbClass, switchTrackClass }
