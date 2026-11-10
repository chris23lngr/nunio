"use client"

import type { ComponentProps, ReactNode } from "react"
import { useId } from "react"
import { Button } from "../button/button.js"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../item/item.js"

function Approval({
  title,
  description,
  children,
  approveLabel = "Erlauben",
  denyLabel = "Ablehnen",
  onDecide,
  busy = false,
  ...props
}: Omit<ComponentProps<typeof Item>, "title"> & {
  title: string
  description: ReactNode
  busy?: boolean
  approveLabel?: string
  denyLabel?: string
  onDecide: (decision: "approve" | "deny") => void
}) {
  const id = useId()
  return (
    <Item
      variant="outline"
      role="group"
      aria-labelledby={id}
      aria-busy={busy}
      {...props}
    >
      <ItemContent className="min-w-0 basis-full gap-2">
        <ItemTitle className="line-clamp-none">
          <h3 id={id}>{title}</h3>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {description}
        </ItemDescription>
        {children && (
          <div className="text-base-500 text-xs leading-5">{children}</div>
        )}
      </ItemContent>
      <ItemActions className="flex-wrap">
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => onDecide("deny")}
        >
          {denyLabel}
        </Button>
        <Button disabled={busy} onClick={() => onDecide("approve")}>
          {approveLabel}
        </Button>
      </ItemActions>
    </Item>
  )
}

export { Approval }
