"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { Blocks, BookOpen, ChevronRight, Loader, Upload } from "lucide-react";
import { CourseDot } from "@/features/shared/components/course-dot";
import type { Course } from "../api/chat-queries";

export function KnowledgeSelector({
  courses,
  selected,
  locked,
  loading,
  error,
  onToggle,
}: {
  courses: Course[];
  selected: Course[];
  locked: boolean;
  loading: boolean;
  error?: string;
  onToggle: (id: string) => void;
}) {
  const count = selected.length;
  const sources = `${count} ${count === 1 ? "Quelle" : "Quellen"}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" />}
        disabled={locked}
        aria-label={
          count ? `Wissen verwalten, ${sources} ausgewählt` : undefined
        }
        className="pr-2 pl-2.5 leading-5 data-popup-open:bg-base-100 data-popup-open:shadow-none"
      >
        {count ? (
          <Loader className="size-4 text-primary-500" />
        ) : (
          <BookOpen className="size-4 text-base-500" />
        )}
        {count ? sources : "Wissen verwalten"}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        className="max-w-[calc(100vw-32px)] min-w-[336px]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Kurse</DropdownMenuLabel>
          {loading && (
            <p role="status" className="px-1.5 text-sm">
              Kurse laden …
            </p>
          )}
          {error && (
            <p role="alert" className="max-w-xs px-1.5 text-sm">
              {error}
            </p>
          )}
          {!loading && !error && !courses.length && (
            <p className="px-1.5 text-sm text-base-500">
              Noch keine bestätigten Kurse.
            </p>
          )}
          {courses.map((course) => (
            <DropdownMenuSwitchItem
              key={course.id}
              checked={selected.some(({ id }) => id === course.id)}
              onCheckedChange={() => onToggle(course.id)}
              closeOnClick={false}
            >
              <CourseDot id={course.id} />
              <span className="min-w-0 truncate">{course.title}</span>
              {course.code && (
                <span className="shrink-0 font-normal text-base-500">
                  {course.code}
                </span>
              )}
            </DropdownMenuSwitchItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <Upload />
            Datei hochladen
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Blocks />
            Konnektoren verwalten
            <ChevronRight className="ml-auto" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
