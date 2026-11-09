"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button focus-visible:ring-primary-500 aria-invalid:ring-destructive-700/20 aria-invalid:outline-destructive-700 inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md py-0 font-sans text-sm font-medium whitespace-nowrap outline-1 outline-offset-0 outline-transparent select-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-white active:not-data-disabled:scale-97 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-2 data-disabled:pointer-events-none data-disabled:opacity-50 forced-colors:focus-visible:outline-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "from-primary-400 to-primary-500 text-primary-950 inset-shadow-button-primary outline-primary-500 hover:to-primary-400 focus-visible:to-primary-400 active:to-primary-400 [&_svg:not([class*='text-'])]:text-primary-900 bg-linear-to-b",
        outline:
          "text-base-800 outline-base-700/15 hover:bg-base-50 [&_svg:not([class*='text-'])]:text-base-500 bg-white shadow-sm active:bg-white",
        destructive:
          "text-destructive-700 outline-base-700/15 hover:bg-destructive-50 hover:outline-destructive-700/15 focus-visible:bg-destructive-50 focus-visible:outline-destructive-700/15 active:bg-destructive-50 active:outline-destructive-700/15 [&_svg:not([class*='text-'])]:text-destructive-500 bg-white shadow-sm",
        ghost:
          "text-base-800 hover:text-base-600 focus-visible:outline-base-700/15 [&_svg:not([class*='text-'])]:text-base-500 bg-transparent focus-visible:bg-white focus-visible:shadow-sm",
      },
      size: {
        default:
          "h-7.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-6.5 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-8.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        icon: "size-7.5 px-0",
        "icon-sm": "size-6.5 px-0",
        "icon-lg": "size-8.5 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
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
