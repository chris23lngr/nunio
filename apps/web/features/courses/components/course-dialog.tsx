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
import { Field, FieldLabel } from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import type { CourseColor } from "../api/course-queries";
import { colors, semesterLabel } from "../course-format";

export type CourseFields = {
  title: string;
  code: string | null;
  semester: string;
  color?: CourseColor;
};

/** Creates a Course, or edits one, when `initial` carries its color. Shown while mounted; closing discards what was typed. */
export function CourseDialog({
  initial,
  choices,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  initial: CourseFields;
  choices: string[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (fields: CourseFields) => void;
}) {
  const editing = initial.color !== undefined;
  const id = useId();
  const [fields, setFields] = useState(initial);
  // A semester outside the offered range, such as one long past, stays selectable on its own Course.
  const semesters = choices.includes(initial.semester)
    ? choices
    : [...choices, initial.semester];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending)
      onSubmit({ ...fields, code: fields.code?.trim() ? fields.code : null });
  };
  const errorId = `${id}-error`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Kurs bearbeiten" : "Kurs erstellen"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Ändere Name, Kürzel, Semester oder Farbe."
              : "Lege einen Kurs an, den nunio nicht aus deinen Quellen erkannt hat."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-title`}>Titel</FieldLabel>
              <Input
                id={`${id}-title`}
                required
                maxLength={500}
                placeholder="z. B. Lineare Algebra I"
                value={fields.title}
                onChange={(e) =>
                  setFields({ ...fields, title: e.target.value })
                }
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-code`}>Kürzel (optional)</FieldLabel>
              <Input
                id={`${id}-code`}
                maxLength={50}
                placeholder="z. B. MA-102"
                value={fields.code ?? ""}
                onChange={(e) => setFields({ ...fields, code: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-semester`}>Semester</FieldLabel>
              <select
                id={`${id}-semester`}
                className="h-7.5 rounded-md bg-white px-2 text-sm text-base-800 shadow-sm outline outline-base-700/15"
                value={fields.semester}
                onChange={(e) =>
                  setFields({ ...fields, semester: e.target.value })
                }
              >
                {semesters.map((semester) => (
                  <option key={semester} value={semester}>
                    {semesterLabel(semester)}
                  </option>
                ))}
              </select>
            </Field>
            {editing && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-base-800">
                  Farbe
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(colors) as CourseColor[]).map((color) => (
                    <label
                      key={color}
                      className="flex size-7 cursor-pointer items-center justify-center rounded-md has-checked:outline-2 has-checked:outline-base-800 has-focus-visible:ring-2 has-focus-visible:ring-primary-500"
                    >
                      <input
                        type="radio"
                        name={`${id}-color`}
                        value={color}
                        aria-label={colors[color].name}
                        checked={fields.color === color}
                        onChange={() => setFields({ ...fields, color })}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="size-4 rounded-xs"
                        style={{ backgroundColor: colors[color].swatch }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {error && (
              <p
                id={errorId}
                role="alert"
                className="text-sm text-destructive-700"
              >
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {editing ? "Speichern" : "Kurs erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
