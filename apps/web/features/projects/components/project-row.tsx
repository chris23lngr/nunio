"use client";

import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, PenLine, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { CourseDot } from "@/features/shared/components/course-dot";
import type { Obligation, Project } from "../api/project-queries";
import { deleteProject, renameProject } from "../api/project-queries";
import { dueLine } from "../project-format";

/** The row's square with the Project's target. */
export function ProjectIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-sm bg-base-100",
        className,
      )}
    >
      <Target className="size-4 text-base-600" />
    </span>
  );
}

/**
 * One Project's row: its name, Courses and Ziel, and a menu to rename it in place or delete it after asking in the
 * row. Only one row edits at a time, so the list owns which one does.
 */
export function ProjectRow({
  apiOrigin,
  project,
  courses,
  obligation,
  coursesPending = false,
  editing,
  onEdit,
}: {
  apiOrigin: string;
  project: Project;
  /** Its Courses, each with its color when known. */
  courses: { id: string; title: string; color?: CourseColor }[];
  /** Its Obligation, when it has one the student can still see. */
  obligation: Obligation | null;
  coursesPending?: boolean;
  editing: "rename" | "delete" | null;
  onEdit: (mode: "rename" | "delete" | null) => void;
}) {
  const queryClient = useQueryClient();
  const rename = useMutation(renameProject(apiOrigin, project.id, queryClient));
  const remove = useMutation(deleteProject(apiOrigin, project.id, queryClient));

  if (editing === "delete")
    return (
      <li className="flex items-center gap-4 rounded-lg border border-destructive-500/30 bg-destructive-50 p-4">
        <ProjectIcon className="bg-white" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium text-base-800">
            {project.name} löschen?
          </span>
          <span className="text-[13px] leading-4.5 text-base-600">
            Kurse und Ziel bleiben erhalten. Nur das Projekt verschwindet.
          </span>
          {remove.error && (
            <span role="alert" className="text-sm text-destructive-600">
              {remove.error.message}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            disabled={remove.isPending}
            onClick={() => onEdit(null)}
          >
            Abbrechen
          </Button>
          <Button
            className="bg-destructive-600 bg-none text-white inset-shadow-none outline-destructive-600 hover:bg-destructive-700 focus-visible:bg-destructive-700 active:bg-destructive-700"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, { onSuccess: () => onEdit(null) })
            }
          >
            Löschen
          </Button>
        </span>
      </li>
    );

  return (
    <li className="flex items-center gap-4 rounded-lg border border-base-200 bg-white p-4">
      <ProjectIcon />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {editing === "rename" ? (
          <RenameField
            name={project.name}
            pending={rename.isPending}
            onCancel={() => {
              rename.reset();
              onEdit(null);
            }}
            onSave={(name) =>
              rename.mutate(name, { onSuccess: () => onEdit(null) })
            }
          />
        ) : (
          <span className="truncate text-sm font-medium text-base-800">
            {project.name}
          </span>
        )}
        {courses.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {courses.map((course) => (
              <span key={course.id} className="flex items-center gap-1.5">
                {course.color && <CourseDot color={course.color} />}
                <span className="text-[13px] leading-4.5 text-base-600">
                  {course.title}
                </span>
              </span>
            ))}
          </span>
        )}
        {editing === "rename" && rename.error && (
          <span role="alert" className="text-sm text-destructive-600">
            {rename.error.message}
          </span>
        )}
      </span>
      <span className="flex w-60 shrink-0 flex-col gap-0.5">
        {project.obligationId === null ? (
          <span className="text-sm text-base-500">Kein Ziel</span>
        ) : coursesPending ? null : (
          <>
            <span className="truncate text-sm font-medium text-base-800">
              {obligation?.title ?? "Eine Pflicht"}
            </span>
            {obligation?.due.date && (
              <span className="text-[13px] leading-4.5 text-base-500">
                {dueLine(obligation.due.date, new Date())}
              </span>
            )}
          </>
        )}
      </span>
      <span className="flex w-5 shrink-0 justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Aktionen für ${project.name}`}
                className="data-popup-open:bg-base-100"
              />
            }
          >
            <Ellipsis aria-hidden="true" className="size-5 text-base-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-62">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  rename.reset();
                  onEdit("rename");
                }}
              >
                <PenLine aria-hidden="true" />
                Umbenennen
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  remove.reset();
                  onEdit("delete");
                }}
              >
                <Trash2 aria-hidden="true" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
}

/** The name in place: Enter saves, Esc leaves it as it was. */
function RenameField({
  name,
  pending,
  onCancel,
  onSave,
}: {
  name: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        // biome-ignore lint/a11y/noAutofocus: the student just asked to rename it.
        autoFocus
        aria-label={`Name von ${name}`}
        value={value}
        maxLength={255}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const next = value.trim();
            if (!next || next === name) onCancel();
            else onSave(next);
          }
        }}
        className="h-7 w-80 max-w-full min-w-0 rounded-md bg-white px-2 text-sm font-medium text-base-800 outline-2 outline-primary-300"
      />
      <span className="shrink-0 text-xs text-base-500">
        Enter speichert · Esc bricht ab
      </span>
    </span>
  );
}
