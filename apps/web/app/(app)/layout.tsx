import { SidebarProvider, SidebarTrigger } from "@nunio/ui/components/sidebar";
import type { ReactNode } from "react";
import { AppSidebar } from "@/features/shared/components/app-sidebar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <SidebarTrigger className="self-start" />
        {children}
      </div>
    </SidebarProvider>
  );
}
