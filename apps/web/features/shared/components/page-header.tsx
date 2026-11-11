import { cn } from "@nunio/ui";
import type * as React from "react";
import { SidebarOpenButton } from "./sidebar-open-button";

// Absolute, not sticky: the header floats over a scroll container the consumer
// owns, so content passes underneath and fades out. The consumer must make the
// page column `relative` and give the scroll content 64px (`pt-16`) top padding.
export function PageHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "absolute inset-x-0 top-0 z-10 flex h-16 items-center gap-4 bg-linear-to-b from-white to-transparent px-8",
        className,
      )}
      {...props}
    >
      <SidebarOpenButton inline />
      {children}
    </header>
  );
}
