"use client"

import { cn } from "cn"
import type { ComponentProps } from "react"
import { Button } from "../button/button.js"

type SuggestionsProps = ComponentProps<"div">

function Suggestions({ className, ...props }: SuggestionsProps) {
  return (
    <div
      data-slot="suggestions"
      className={cn("flex flex-wrap justify-center gap-4", className)}
      {...props}
    />
  )
}

type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string
  onClick?: (suggestion: string) => void
}

function Suggestion({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) {
  return (
    <Button
      data-slot="suggestion"
      type="button"
      variant={variant}
      size={size}
      className={(state) =>
        cn(
          "text-base-600 h-6 rounded-full px-2 shadow-[0_1px_2px_#0000000D]",
          typeof className === "function" ? className(state) : className,
        )
      }
      onClick={() => onClick?.(suggestion)}
      {...props}
    >
      {children ?? suggestion}
    </Button>
  )
}

export { Suggestion, type SuggestionProps, Suggestions, type SuggestionsProps }
