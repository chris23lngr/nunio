"use client";

import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import { useSidebar } from "@nunio/ui/components/sidebar/sidebar";
import { PanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";

/** Pages that render a PageHeader, which places its own `inline` button. */
const ownHeader = ["/chat", "/plan"];

/**
 * Opens the closed sidebar. The layout floats one over every page; screens with
 * their own header place an `inline` one there instead.
 */
export function SidebarOpenButton({ inline = false }: { inline?: boolean }) {
  const { open, isMobile, openMobile, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  if (isMobile ? openMobile : open) return null;
  if (!inline && ownHeader.some((page) => pathname.startsWith(page)))
    return null;

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Sidebar öffnen"
      className={cn(!inline && "absolute top-6 left-5 z-20")}
      onClick={toggleSidebar}
    >
      <PanelLeft aria-hidden="true" />
    </Button>
  );
}
