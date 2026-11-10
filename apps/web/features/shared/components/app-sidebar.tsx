"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@nunio/ui/components/sidebar/sidebar";
import {
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  GraduationCap,
  House,
  Inbox,
  ListChecks,
  MessageSquare,
  Settings,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  { title: "Home", href: "/", icon: House },
  { title: "Inbox", href: "/inbox", icon: Inbox },
  { title: "Account", href: "/account", icon: UserRound },
  { title: "Review", href: "/review", icon: ClipboardCheck },
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Plan", href: "/plan", icon: CalendarDays },
  { title: "Study", href: "/study", icon: GraduationCap },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Responsibilities", href: "/responsibilities", icon: ListChecks },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const settingsActive = pathname.startsWith("/settings/");

  return (
    <Sidebar>
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
