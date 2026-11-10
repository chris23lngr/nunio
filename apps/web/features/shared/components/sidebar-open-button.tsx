"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useSidebar } from "@nunio/ui/components/sidebar/sidebar";
import { PanelLeft } from "lucide-react";

export function SidebarOpenButton() {
  const { open, isMobile, openMobile, toggleSidebar } = useSidebar();
  if (isMobile ? openMobile : open) return null;

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Sidebar öffnen"
      className="absolute top-6 left-5 z-20"
      onClick={toggleSidebar}
    >
      <PanelLeft aria-hidden="true" />
    </Button>
  );
}
