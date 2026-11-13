"use client";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@nunio/ui/components/sidebar/sidebar";
import { Skeleton } from "@nunio/ui/components/skeleton/skeleton";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { CourseDot } from "@/features/shared/components/course-dot";

/** The Courses the student last worked on, by Last Activity. */
export function RecentCourses({ apiOrigin }: { apiOrigin: string }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const {
    data: courses,
    isPending,
    isSuccess,
    isError,
    refetch,
  } = useQuery({
    ...courseListQuery(apiOrigin),
    select: (list) =>
      list.courses
        .filter(
          (course) =>
            course.status === "accepted" &&
            !course.archived &&
            course.lastActivityAt,
        )
        .toSorted((a, b) =>
          (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
        )
        .slice(0, 3),
  });

  return (
    <SidebarGroup
      role="group"
      aria-labelledby="recent-courses-label"
      aria-busy={isPending}
    >
      <SidebarGroupLabel id="recent-courses-label">
        Recent Courses
      </SidebarGroupLabel>
      {isPending ? (
        <div aria-hidden="true" className="flex flex-col gap-1">
          {["w-41", "w-22", "w-31"].map((width) => (
            <div key={width} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="flex size-4 shrink-0 items-center justify-center">
                <Skeleton className="size-2 rounded-xs bg-base-200" />
              </span>
              <span className="flex h-4.5 items-center">
                <Skeleton className={`h-2.5 rounded-sm bg-base-200 ${width}`} />
              </span>
            </div>
          ))}
        </div>
      ) : isError ? (
        <Notice>
          Couldn’t load your courses
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 font-medium text-primary-600"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Try again
          </button>
        </Notice>
      ) : isSuccess && courses.length === 0 ? (
        <Notice>Recent courses appear here</Notice>
      ) : (
        <SidebarMenu>
          {courses?.map((course) => {
            const href = `/courses/${course.id}`;
            const isActive =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <SidebarMenuItem key={course.id}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={isActive}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setOpenMobile(false)}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <CourseDot color={course.color} />
                  </span>
                  <span>{course.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}

/** A dashed box in place of the list, lined up with the group label. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mx-2.5 flex flex-col items-center gap-2 rounded-sm border border-dashed border-base-200 px-2.5 py-3 text-center text-sm leading-5 text-base-500">
      {children}
    </div>
  );
}
