"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@nunio/ui/components/sidebar/sidebar";
import {
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  House,
  ListChecks,
  MessageSquare,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  { title: "Home", href: "/", icon: House },
  { title: "Account", href: "/account", icon: UserRound },
  { title: "Review", href: "/review", icon: ClipboardCheck },
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Plan", href: "/plan", icon: CalendarDays },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Responsibilities", href: "/responsibilities", icon: ListChecks },
];

export function AppSidebar() {
  const pathname = usePathname();

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
    </Sidebar>
  );
}
