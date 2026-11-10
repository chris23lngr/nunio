"use client"

import { cn } from "cn"
import type { ComponentProps } from "react"
import { Button } from "../button/button.js"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../hover-card/hover-card.js"

function Citation({
  tag,
  title,
  description,
  href,
  className,
  ...props
}: Omit<ComponentProps<"span">, "title"> & {
  tag: string
  title: string
  description?: string
  href?: string
}) {
  return (
    <span
      data-slot="citation"
      className={cn("inline-flex align-baseline", className)}
      {...props}
    >
      <HoverCard>
        <HoverCardTrigger
          delay={100}
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-primary-700 h-5 rounded px-1 text-xs"
            />
          }
          aria-label={`Quelle ${tag}: ${title}`}
        >
          [{tag}]
        </HoverCardTrigger>
        <HoverCardContent align="start" className="flex flex-col gap-2 p-3">
          <p className="font-medium">{title}</p>
          {description && <p className="text-base-600">{description}</p>}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary-700 focus-visible:ring-primary-500 rounded underline underline-offset-4 focus-visible:ring-2"
            >
              Quelle öffnen
            </a>
          )}
        </HoverCardContent>
      </HoverCard>
    </span>
  )
}

function CitationList({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="citation-list"
      className={cn(
        "text-base-600 flex flex-wrap items-center gap-2 text-sm",
        className,
      )}
      {...props}
    />
  )
}

export { Citation, CitationList }
