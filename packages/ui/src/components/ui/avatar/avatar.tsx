"use client"

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "cn"
import type * as React from "react"

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-6 shrink-0 rounded-md select-none data-[size=lg]:size-8 data-[size=lg]:rounded-lg data-[size=sm]:size-5 data-[size=sm]:rounded-[5px]",
        className,
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-[inherit] object-cover",
        className,
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-primary-100 text-primary-600 flex size-full items-center justify-center rounded-[inherit] text-xs font-medium group-data-[size=lg]/avatar:text-sm",
        className,
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "bg-primary-500 absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full text-white ring-2 ring-white select-none",
        "group-data-[size=sm]/avatar:size-1.5 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2 group-data-[size=default]/avatar:[&>svg]:hidden",
        "group-data-[size=lg]/avatar:size-2.5 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-1.5 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-white",
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "bg-primary-100 text-primary-600 relative flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium ring-2 ring-white group-has-data-[size=lg]/avatar-group:size-8 group-has-data-[size=lg]/avatar-group:rounded-lg group-has-data-[size=lg]/avatar-group:text-sm group-has-data-[size=sm]/avatar-group:size-5 group-has-data-[size=sm]/avatar-group:rounded-[5px] [&>svg]:size-3.5 group-has-data-[size=lg]/avatar-group:[&>svg]:size-4 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className,
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
}
