"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@nunio/ui/components/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  { title: "Home", href: "/" },
  { title: "Inbox", href: "/inbox" },
  { title: "Account", href: "/account" },
  { title: "Review", href: "/review" },
  { title: "Chat", href: "/chat" },
  { title: "Plan", href: "/plan" },
  { title: "Projects", href: "/projects" },
  { title: "Responsibilities", href: "/responsibilities" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar className="sticky top-0 h-svh" aria-label="App navigation">
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map(({ title, href }) => {
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
