"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import { Input } from "@nunio/ui/components/input/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { CourseDot } from "@/features/shared/components/course-dot";
import type { ProjectCourse } from "../api/project-queries";
import { createProject } from "../api/project-queries";
import { dueDay } from "../project-format";

/** "Neues Projekt": a name, optionally Courses, and optionally a Pflicht of those Courses as its Ziel. */
export function NewProjectSheet({
  apiOrigin,
  open,
  courses,
  coursesPending = false,
  coursesError = null,
  colors,
  onClose,
}: {
  apiOrigin: string;
  open: boolean;
  courses: ProjectCourse[];
  coursesPending?: boolean;
  coursesError?: string | null;
  colors: Map<string, CourseColor>;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right">
        {/* Remounted on each opening, so the form starts empty. */}
        {open && (
          <NewProjectForm
            apiOrigin={apiOrigin}
            courses={courses}
            coursesPending={coursesPending}
            coursesError={coursesError}
            colors={colors}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function NewProjectForm({
  apiOrigin,
  courses,
  coursesPending,
  coursesError,
  colors,
  onClose,
}: {
  apiOrigin: string;
  courses: ProjectCourse[];
  coursesPending: boolean;
  coursesError: string | null;
  colors: Map<string, CourseColor>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useMutation(createProject(apiOrigin, queryClient));
  const [name, setName] = useState("");
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [obligationId, setObligationId] = useState("");
  const chosen = courses.filter((course) => courseIds.includes(course.id));
  const obligations = chosen.flatMap((course) =>
    course.obligations.map((obligation) => ({ ...obligation, course })),
  );
  // A Ziel must belong to a chosen Course; unchecking its Course drops it.
  const ziel = obligations.some((o) => o.id === obligationId)
    ? obligationId
    : "";
  const toggle = (id: string) =>
    setCourseIds((ids) =>
      ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id],
    );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, courseIds, obligationId: ziel || null },
      { onSuccess: onClose },
    );
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Neues Projekt</SheetTitle>
        <SheetDescription>Bündle Kurse auf ein Ziel hin.</SheetDescription>
      </SheetHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="new-project-name"
              className="text-sm font-medium text-base-800"
            >
              Name
            </label>
            <Input
              id="new-project-name"
              required
              maxLength={255}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-4">
            <legend className="contents">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-base-800">Kurse</span>
                <span className="text-[13px] leading-4.5 text-base-500">
                  Optional. Ein Projekt kann auch ohne Kurs starten.
                </span>
              </span>
            </legend>
            {coursesError ? (
              <p role="alert" className="text-sm text-destructive-600">
                {coursesError}
              </p>
            ) : coursesPending ? null : courses.length === 0 ? (
              <p className="text-sm text-base-500">
                Du hast noch keine bestätigten Kurse.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {courses.map((course) => {
                  const color = colors.get(course.id);
                  return (
                    <li key={course.id}>
                      <label
                        htmlFor={`new-project-course-${course.id}`}
                        className="flex cursor-pointer items-start gap-3"
                      >
                        <Checkbox
                          id={`new-project-course-${course.id}`}
                          className="mt-0.5"
                          checked={courseIds.includes(course.id)}
                          onCheckedChange={() => toggle(course.id)}
                        />
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-base-800">
                            {course.title}
                          </span>
                          {color && <CourseDot color={color} />}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          <div className="flex flex-col gap-2">
            <span className="flex flex-col gap-0.5">
              <label
                htmlFor="new-project-ziel"
                className="text-sm font-medium text-base-800"
              >
                Ziel
              </label>
              <span className="text-[13px] leading-4.5 text-base-500">
                Optional. Eine Pflicht aus den gewählten Kursen, auf die das
                Projekt hinarbeitet.
              </span>
            </span>
            <Select
              value={ziel}
              onValueChange={(value) => setObligationId(value ?? "")}
              items={[
                { value: "", label: "Kein Ziel" },
                ...obligations.map((o) => ({ value: o.id, label: o.title })),
              ]}
            >
              <SelectTrigger
                id="new-project-ziel"
                aria-label="Ziel"
                className="w-96 max-w-full font-normal"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                sideOffset={8}
                alignItemWithTrigger={false}
                className="p-1"
              >
                <SelectGroup>
                  <SelectItem value="" className="font-normal text-base-600">
                    Kein Ziel
                  </SelectItem>
                </SelectGroup>
                {obligations.length > 0 && (
                  <>
                    <SelectSeparator className="my-1" />
                    <SelectGroup>
                      {obligations.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          <span className="flex flex-col">
                            <span className="text-sm font-normal text-base-800">
                              {o.title}
                            </span>
                            <span className="text-xs font-normal text-base-500">
                              {o.due.date
                                ? `${o.course.title} · ${dueDay(o.due.date)}`
                                : o.course.title}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          {create.error && (
            <p role="alert" className="text-sm text-destructive-600">
              {create.error.message}
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button
            type="submit"
            className="h-8"
            disabled={create.isPending || !name.trim()}
          >
            Erstellen
          </Button>
          <Button variant="outline" type="button" onClick={onClose}>
            Abbrechen
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
