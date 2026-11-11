import { cn } from "@nunio/ui";
import type * as React from "react";

// Absolute, not sticky: the header floats over a scroll container the consumer
// owns, so messages pass underneath and fade out. The consumer must make the
// chat column `relative` and give the message list 64px (`pt-16`) top padding.
export function ChatHeader({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "absolute inset-x-0 top-0 z-10 flex h-16 items-center gap-4 bg-linear-to-b from-white to-transparent px-8",
        className,
      )}
      {...props}
    />
  );
}
