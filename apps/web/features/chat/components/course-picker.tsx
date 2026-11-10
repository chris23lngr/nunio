"use client";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { Book, ChevronDown, X } from "lucide-react";
import type { Course } from "../api/chat-queries";

function Dot({ id }: { id: string }) {
  const colors = [
    "bg-rose-500",
    "bg-fuchsia-500",
    "bg-purple-500",
    "bg-sky-500",
  ];
  const index =
    Array.from(id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) %
    colors.length;
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-xs ${colors[index]}`}
    />
  );
}

export function CoursePicker({
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
  return (
    <div className="mb-3 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-2 px-4 text-sm leading-5">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={locked}
          className="disabled:opacity-50 inline-flex shrink-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Book className="size-3.5 text-base-500" />
          Kurs auswählen
          <ChevronDown className="size-3.5 text-base-500" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          sideOffset={20}
          className="max-w-[calc(100vw-32px)] min-w-[336px]"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Deine Kurse</DropdownMenuLabel>
            {loading && (
              <p role="status" className="px-2 text-sm">
                Kurse laden …
              </p>
            )}
            {error && (
              <p role="alert" className="max-w-xs px-2 text-sm">
                {error}
              </p>
            )}
            {!loading && !error && !courses.length && (
              <p className="px-2 text-sm text-base-500">
                Noch keine bestätigten Kurse.
              </p>
            )}
            {courses.map((course) => (
              <DropdownMenuCheckboxItem
                key={course.id}
                checked={selected.some(({ id }) => id === course.id)}
                onCheckedChange={() => onToggle(course.id)}
                closeOnClick={false}
              >
                <Dot id={course.id} />
                <span className="min-w-0 truncate">{course.title}</span>
                {course.code && (
                  <span className="shrink-0 font-normal text-base-500">
                    {course.code}
                  </span>
                )}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected.map((course) => (
        <span
          key={course.id}
          className="inline-flex min-w-0 max-w-full items-center gap-2"
        >
          <Dot id={course.id} />
          <span className="truncate" title={course.title}>
            {course.title}
          </span>
          {!locked && (
            <button
              type="button"
              aria-label={`${course.title} entfernen`}
              onClick={() => onToggle(course.id)}
              className="shrink-0 text-base-500 focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
