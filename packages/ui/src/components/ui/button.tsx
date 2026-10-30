"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils.js"

// Spec: docs/notion-spec/components/button.md
// `size` is declared before `variant`: variants that own their geometry (pill, assistant)
// come later in the class list, so cn() lets them override the size.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-sm leading-[1.2] whitespace-nowrap outline-hidden transition-[background-color] duration-100 ease-in-out select-none focus-visible:shadow-focus-button data-disabled:pointer-events-none data-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      size: {
        sm: "h-6 gap-1 px-1.5 [&_svg:not([class*='size-'])]:size-4",
        // Notion's svg boxes hug their glyph (the lock is 12×20); a 16px Lucide icon draws
        // the same visual size, where a 20px one adds 4–8px of width
        default: "h-7 gap-1.5 px-2 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-8 gap-2 px-3 [&_svg:not([class*='size-'])]:size-4",
        compact: "h-7 px-2 py-1.5 text-xs",
        // Notion's 28px icon buttons draw ~15px filled glyphs in a 20px box
        icon: "size-7 duration-[20ms] ease-in [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-4",
      },
      variant: {
        ghost:
          "text-primary hover:bg-interactive-translucent focus-visible:bg-interactive-translucent data-popup-open:bg-interactive-translucent active:bg-interactive-translucent-200 [&_svg:not([class*='text-'])]:text-icon-primary",
        primary:
          "bg-blue-accent text-blue-inverse hover:bg-blue-accent-hover focus-visible:bg-blue-accent-hover active:bg-blue-accent-pressed font-medium",
        secondary:
          "bg-tertiary-translucent text-primary hover:bg-tertiary-translucent-150 focus-visible:bg-tertiary-translucent-150 active:bg-tertiary-translucent-200 font-medium",
        outline:
          "border-primary-translucent text-primary hover:bg-interactive-translucent focus-visible:bg-interactive-translucent active:bg-interactive-translucent-150 [&_svg:not([class*='text-'])]:text-icon-secondary border font-medium duration-[20ms] ease-in",
        destructive:
          "bg-red-secondary-translucent text-red-accent hover:bg-red-secondary-translucent-150 focus-visible:bg-red-secondary-translucent-150 active:bg-red-secondary-translucent-200 font-medium",
        pill: "bg-tertiary-translucent text-primary hover:bg-tertiary-translucent-150 focus-visible:bg-tertiary-translucent-150 active:bg-tertiary-translucent-200 [&_svg:not([class*='text-'])]:text-icon-primary h-8 gap-1 rounded-full py-1.5 pr-3.5 pl-2.5 leading-5 font-medium [&_svg:not([class*='size-'])]:size-5",
        // Notion's icon here is a fixed-color image, so it stays dark on the light
        // dark-theme background (#d3d3d3); pin Lucide icons to match
        assistant:
          "bg-assistant-button text-primary hover:bg-assistant-button-hover active:bg-assistant-button-pressed size-10 rounded-full p-0 shadow-md transition-transform duration-250 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 [&_svg:not([class*='size-'])]:size-5 [&_svg:not([class*='text-'])]:text-black",
      },
    },
    compoundVariants: [
      {
        variant: "ghost",
        size: "icon-sm",
        class: "[&_svg:not([class*='text-'])]:text-icon-secondary",
      },
      {
        variant: "ghost",
        size: "icon-xs",
        class:
          "text-secondary [&_svg:not([class*='text-'])]:text-icon-secondary",
      },
      { variant: "secondary", size: "default", class: "px-3 py-2" },
      { variant: "outline", size: "compact", class: "text-secondary" },
    ],
    defaultVariants: {
      variant: "ghost",
      size: "default",
    },
  },
)

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={(state) =>
        cn(
          buttonVariants({ variant, size }),
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  )
}

export { Button, type ButtonProps, buttonVariants }
