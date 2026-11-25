"use client";

import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nunio/ui/components/dialog/dialog";
import { Input } from "@nunio/ui/components/input/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import type { FormEvent, ReactNode } from "react";
import { useId, useState } from "react";
import type { Course, Obligation } from "./review-format";
import { courseName, kinds } from "./review-format";

const fieldLabel = "text-[13px] leading-4.5 font-medium text-base-700";
const fieldInput = "h-8.5 font-normal text-base-900";

function DialogField({
  label,
  optional,
  className,
  children,
}: {
  label: string;
  optional?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && (
          <span className="font-normal text-base-500"> (optional)</span>
        )}
      </label>
      {children(id)}
    </div>
  );
}

function CourseDot({
  swatch,
  proposed,
}: {
  swatch?: string;
  proposed?: boolean;
}) {
  if (proposed) {
    return (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full border-[1.5px] border-dashed border-base-400"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: swatch ?? "var(--base-400)" }}
    />
  );
}

export type AddObligationInput = {
  course: { id: string } | { title: string; code: string | null };
  kind: Obligation["kind"];
  title: string;
  due: { date: string | null; time: string | null; timeZone: string | null };
  destination: string | null;
};

/** Inner form mounted only while open so background polls cannot reset what the student typed. */
function AddObligationForm({
  accepted,
  initialCourse,
  courseColors,
  busy,
  onCancel,
  onSubmit,
}: {
  accepted: Course[];
  initialCourse: string;
  courseColors: Record<string, string>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: AddObligationInput) => Promise<string | null>;
}) {
  const [courseId, setCourseId] = useState<string>(initialCourse);
  const [kind, setKind] = useState<Obligation["kind"]>("assignment");
  const [error, setError] = useState<string | null>(null);

  const isNewCourse = courseId === "new" || accepted.length === 0;
  const courseItems = [
    ...accepted.map((course) => ({
      value: course.id,
      label: courseName(course),
    })),
    { value: "new", label: "Neuer Kurs…" },
  ];
  const kindItems = Object.entries(kinds).map(([value, label]) => ({
    value,
    label,
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "").trim() || null;
    const course = isNewCourse
      ? { title: field("courseTitle") ?? "", code: field("courseCode") }
      : { id: courseId };
    setError(null);
    const failure = await onSubmit({
      course,
      kind,
      title: field("title") ?? "",
      due: {
        date: field("date"),
        time: field("time"),
        timeZone: field("timeZone"),
      },
      destination: field("destination"),
    });
    if (failure) {
      setError(failure);
      return;
    }
    form.reset();
    onCancel();
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <DialogHeader className="gap-1 px-5 pt-5 pb-4">
        <DialogTitle className="pr-8 text-base leading-6 font-semibold text-base-900">
          Frist hinzufügen
        </DialogTitle>
        <DialogDescription className="text-sm text-base-600">
          Für Fristen, die in keiner Quelle stehen. Was du einträgst, gilt als
          bestätigt.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3.5 px-5 pt-1 pb-5">
        {error && (
          <p role="alert" className="text-sm text-destructive-600">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <DialogField label="Kurs" className="min-w-48 flex-1">
            {(id) => (
              <Select
                name="course"
                value={isNewCourse ? "new" : courseId}
                items={courseItems}
                onValueChange={(value) => {
                  if (value) setCourseId(value);
                }}
              >
                <SelectTrigger
                  id={id}
                  aria-label="Kurs"
                  className="h-8.5 w-full"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {!isNewCourse && (
                      <CourseDot swatch={courseColors[courseId]} />
                    )}
                    <SelectValue className="truncate" />
                  </span>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  sideOffset={8}
                  alignItemWithTrigger={false}
                >
                  <SelectGroup>
                    {accepted.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        <span className="flex items-center gap-2">
                          <CourseDot swatch={courseColors[course.id]} />
                          {courseName(course)}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value="new">Neuer Kurs…</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </DialogField>
          <DialogField label="Art" className="w-[170px] shrink-0">
            {(id) => (
              <Select
                name="kind"
                value={kind}
                items={kindItems}
                onValueChange={(value) => {
                  if (value) setKind(value as Obligation["kind"]);
                }}
              >
                <SelectTrigger
                  id={id}
                  aria-label="Art"
                  className="h-8.5 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  sideOffset={8}
                  alignItemWithTrigger={false}
                >
                  <SelectGroup>
                    {kindItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </DialogField>
        </div>
        {isNewCourse && (
          <div className="flex flex-wrap gap-3">
            <DialogField label="Kurstitel" className="min-w-44 flex-1">
              {(id) => (
                <Input
                  id={id}
                  name="courseTitle"
                  required
                  className={fieldInput}
                />
              )}
            </DialogField>
            <DialogField label="Kürzel" optional className="w-36 shrink-0">
              {(id) => (
                <Input id={id} name="courseCode" className={fieldInput} />
              )}
            </DialogField>
          </div>
        )}
        <DialogField label="Titel">
          {(id) => (
            <Input
              id={id}
              name="title"
              required
              placeholder="z. B. Anmeldung zur Nachklausur"
              className={fieldInput}
            />
          )}
        </DialogField>
        <div className="flex flex-wrap gap-3">
          <DialogField label="Datum" className="min-w-36 flex-1">
            {(id) => (
              <Input id={id} name="date" type="date" className={fieldInput} />
            )}
          </DialogField>
          <DialogField label="Uhrzeit" className="w-26 shrink-0">
            {(id) => (
              <Input id={id} name="time" type="time" className={fieldInput} />
            )}
          </DialogField>
          <DialogField label="Zeitzone" className="w-[150px] shrink-0">
            {(id) => (
              <Input
                id={id}
                name="timeZone"
                placeholder="Europe/Berlin"
                className={fieldInput}
              />
            )}
          </DialogField>
        </div>
        <DialogField label="Abgabe" optional>
          {(id) => (
            <Input
              id={id}
              name="destination"
              placeholder="z. B. Prüfungsportal oder Moodle"
              className={fieldInput}
            />
          )}
        </DialogField>
      </DialogBody>
      <DialogFooter className="flex-row items-center justify-end gap-2 rounded-b-[14px] px-5 py-3.5">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          className="text-base-600"
          onClick={onCancel}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={busy} className="px-3">
          Hinzufügen
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Modal dialog for manually adding an Obligation (review/frist-hinzufuegen). */
export function AddObligationDialog({
  open,
  onOpenChange,
  accepted,
  defaultCourseId,
  courseColors,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accepted: Course[];
  defaultCourseId: string | null;
  courseColors: Record<string, string>;
  busy: boolean;
  onSubmit: (body: AddObligationInput) => Promise<string | null>;
}) {
  const initialCourse =
    (defaultCourseId && accepted.find((c) => c.id === defaultCourseId)?.id) ??
    accepted[0]?.id ??
    "new";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] rounded-[14px] p-0">
        {open && (
          <AddObligationForm
            accepted={accepted}
            initialCourse={initialCourse}
            courseColors={courseColors}
            busy={busy}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeCourseForm({
  course,
  targets,
  courseColors,
  busy,
  onClose,
  onMerge,
}: {
  course: Course;
  targets: Course[];
  courseColors: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onMerge: (source: Course, target: Course) => Promise<string | null>;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = targets.map((other) => ({
    value: other.id,
    label: courseName(other),
  }));
  const chosen = targets.find((other) => other.id === targetId) ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) return;
    setError(null);
    const failure = await onMerge(course, chosen);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <DialogHeader className="gap-1 px-5 pt-5 pb-4">
        <DialogTitle className="pr-8 text-base leading-6 font-semibold text-base-900">
          Kurs zusammenführen
        </DialogTitle>
        <DialogDescription className="text-sm text-base-600">
          Wähle den Kurs, in den „{courseName(course)}“ übernommen werden soll.
          Alle Einträge und Quellen wandern mit.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3.5 px-5 pt-1 pb-5">
        {error && (
          <p role="alert" className="text-sm text-destructive-600">
            {error}
          </p>
        )}
        <DialogField label="Gleicher Kurs wie">
          {(id) => (
            <Select
              name="into"
              value={targetId}
              items={items}
              onValueChange={(value) => {
                setTargetId(value);
                setError(null);
              }}
            >
              <SelectTrigger
                id={id}
                aria-label="Gleicher Kurs wie"
                className="h-8.5 w-full"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {chosen && (
                    <CourseDot
                      swatch={courseColors[chosen.id]}
                      proposed={chosen.status === "proposed"}
                    />
                  )}
                  <SelectValue placeholder="Kurs wählen" className="truncate" />
                </span>
              </SelectTrigger>
              <SelectContent
                align="start"
                sideOffset={8}
                alignItemWithTrigger={false}
              >
                <SelectGroup>
                  {targets.map((other) => (
                    <SelectItem key={other.id} value={other.id}>
                      <span className="flex items-center gap-2">
                        <CourseDot
                          swatch={courseColors[other.id]}
                          proposed={other.status === "proposed"}
                        />
                        {courseName(other)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </DialogField>
      </DialogBody>
      <DialogFooter className="flex-row items-center justify-end gap-2 rounded-b-[14px] px-5 py-3.5">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          className="text-base-600"
          onClick={onClose}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={busy} className="px-3">
          Zusammenführen
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Modal dialog for merging one Course into another ("Gleicher Kurs wie …"). */
export function MergeCourseDialog({
  course,
  targets,
  courseColors,
  busy,
  onClose,
  onMerge,
}: {
  course: Course | null;
  targets: Course[];
  courseColors: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onMerge: (source: Course, target: Course) => Promise<string | null>;
}) {
  return (
    <Dialog
      open={course !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-[480px] rounded-[14px] p-0">
        {course && (
          <MergeCourseForm
            key={course.id}
            course={course}
            targets={targets}
            courseColors={courseColors}
            busy={busy}
            onClose={onClose}
            onMerge={onMerge}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
