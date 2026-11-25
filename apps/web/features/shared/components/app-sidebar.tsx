"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@nunio/ui/components/sidebar/sidebar";
import {
  BookOpen,
  Bot,
  Calendar,
  ClipboardCheck,
  Files,
  Folder,
  GraduationCap,
  Inbox,
  MessagesCircle,
  Settings,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/features/auth/user-menu";
import { RecentCourses } from "@/features/shared/components/recent-courses";

const menuItems = [
  { title: "Heute", href: "/", icon: Sun },
  { title: "Eingang", href: "/inbox", icon: Inbox },
  { title: "Plan", href: "/plan", icon: Calendar },
  { title: "Chat", href: "/chat", icon: MessagesCircle },
  { title: "Lernen", href: "/study", icon: GraduationCap },
  { title: "Artefakte", href: "/artifacts", icon: Files },
  { title: "Prüfen", href: "/review", icon: ClipboardCheck },
  { title: "Projekte", href: "/projects", icon: Folder },
  { title: "Agenten", href: "/agents", icon: Bot },
  { title: "Kurse", href: "/courses", icon: BookOpen },
];

export function AppSidebar({ apiOrigin }: { apiOrigin: string }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const settingsActive = pathname.startsWith("/settings/");

  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between gap-4 pr-6.5 pl-3">
        <UserMenu apiOrigin={apiOrigin} />
        <SidebarTrigger aria-label="Sidebar schließen" className="-mr-1.25" />
      </SidebarHeader>
      <SidebarContent role="navigation" aria-label="App navigation">
        <SidebarMenu>
          {menuItems.map(({ title, href, icon: Icon }) => {
            const isActive =
              pathname === href ||
              (href !== "/" && pathname.startsWith(`${href}/`));

            return (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={isActive}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>{title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
        <RecentCourses apiOrigin={apiOrigin} />
      </SidebarContent>
      <SidebarFooter role="navigation" aria-label="Weitere Navigation">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/settings/security" />}
              isActive={settingsActive}
              aria-current={settingsActive ? "page" : undefined}
              tooltip="Einstellungen"
              onClick={() => setOpenMobile(false)}
            >
              <Settings aria-hidden="true" />
              <span>Einstellungen</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
