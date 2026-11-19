"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import { Search } from "lucide-react";
import { useState } from "react";
import { CourseDot } from "@/features/shared/components/course-dot";
import type { AgentCourse } from "../api/agent-queries";
import { courseSize } from "../course-size";

/**
 * "Kurse verwalten": picks the Agent's Courses among those it can be given. Courses it has that are no longer offered,
 * such as an Archived one, stay on the Agent.
 */
export function EditCoursesSheet({
  open,
  offered,
  loading,
  error,
  selected,
  onSave,
  onClose,
}: {
  open: boolean;
  offered: AgentCourse[];
  loading: boolean;
  error?: string;
  selected: string[];
  onSave: (courseIds: string[]) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right">
        {/* Remounted on each opening, so the checkboxes start from the Agent's Courses. */}
        {open && (
          <CourseChoice
            offered={offered}
            loading={loading}
            error={error}
            selected={selected}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CourseChoice({
  offered,
  loading,
  error,
  selected,
  onSave,
  onClose,
}: {
  offered: AgentCourse[];
  loading: boolean;
  error?: string;
  selected: string[];
  onSave: (courseIds: string[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(selected);
  const [query, setQuery] = useState("");
  const shown = offered.filter((course) =>
    course.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const toggle = (id: string) =>
    setChecked((ids) =>
      ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id],
    );
  return (
    <>
      <SheetHeader>
        <SheetTitle>Kurse verwalten</SheetTitle>
        <SheetDescription>
          Bestimme, auf welche Kurse ein Agent zugreifen darf.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-6">
        <InputGroup className="max-w-96">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Kurse durchsuchen"
            placeholder="Kurse durchsuchen …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        {loading && (
          <p role="status" className="text-sm text-base-500">
            Kurse laden …
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive-600">
            {error}
          </p>
        )}
        {!loading && !error && !offered.length && (
          <p className="text-sm text-base-500">
            Du hast noch keine bestätigten Kurse.
          </p>
        )}
        {!!offered.length && !shown.length && (
          <p className="text-sm text-base-500">
            Kein Kurs passt zu deiner Suche.
          </p>
        )}
        {!!shown.length && (
          <ul className="flex flex-col gap-6">
            {shown.map((course) => (
              <li key={course.id}>
                <label
                  htmlFor={`agent-course-${course.id}`}
                  className="flex cursor-pointer items-start gap-3"
                >
                  <Checkbox
                    id={`agent-course-${course.id}`}
                    className="mt-0.5"
                    checked={checked.includes(course.id)}
                    onCheckedChange={() => toggle(course.id)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm leading-5 font-medium text-base-800">
                        {course.title}
                      </span>
                      <CourseDot color={course.color} />
                    </span>
                    <span className="text-xs leading-4 text-base-500">
                      {courseSize(course)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </SheetBody>
      <SheetFooter>
        <Button
          onClick={() =>
            onSave([
              ...selected.filter(
                (id) =>
                  checked.includes(id) ||
                  !offered.some((course) => course.id === id),
              ),
              ...checked.filter((id) => !selected.includes(id)),
            ])
          }
        >
          Speichern
        </Button>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
      </SheetFooter>
    </>
  );
}
