"use client"

import { CircleCheck, LoaderCircle } from "lucide-react"
import type { ComponentProps } from "react"
import { useState } from "react"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../trace/trace.js"

function Reasoning({
  children,
  streaming = false,
  answering = streaming,
  duration,
  ...props
}: Omit<ComponentProps<typeof Trace>, "children"> & {
  children: string
  streaming?: boolean
  /** Keeps the trace open after reasoning ends, while its answer is still being written. */
  answering?: boolean
  duration?: number
}) {
  const [open, setOpen] = useState<boolean>()
  const line = (
    <TraceLine status={streaming ? "running" : undefined}>
      <TraceIcon>
        {streaming ? (
          <LoaderCircle className="motion-safe:animate-spin" />
        ) : (
          <CircleCheck />
        )}
      </TraceIcon>
      <TraceTitle>{streaming ? "Denkt nach …" : "Gedankengang"}</TraceTitle>
      {!streaming && duration !== undefined && (
        <TraceDescription>{duration} s</TraceDescription>
      )}
    </TraceLine>
  )
  return (
    <Trace {...props}>
      {children.length === 0 ? (
        <div role="status">{line}</div>
      ) : (
        <TraceCollapsible open={open ?? answering} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="whitespace-pre-wrap">
            {children}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  )
}

export { Reasoning }
