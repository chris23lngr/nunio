import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import type { ReactNode } from "react";
import { AppSidebar } from "@/features/shared/components/app-sidebar";
import { SidebarOpenButton } from "@/features/shared/components/sidebar-open-button";
import { apiOrigin } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider className="relative">
      <AppSidebar apiOrigin={apiOrigin()} />
      <SidebarOpenButton />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </SidebarProvider>
  );
}
