import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { changeSourceCourse } from "../api/source-mutations";
import { sourceQueries } from "../api/source-queries";
import { CourseChoiceFields, courseChoiceFrom } from "./course-choice-fields";

/** The Course a Source is bound to, and "Kurs ändern", which reads a ready Source again under the new choice. */
export function SourceCourse({
  apiOrigin,
  sourceId,
}: {
  apiOrigin: string;
  sourceId: string;
}) {
  const queryClient = useQueryClient();
  const source = useQuery(sourceQueries(apiOrigin)).data?.find(
    (s) => s.id === sourceId,
  );
  const courses = useQuery(courseListQuery(apiOrigin)).data?.courses ?? [];
  const change = useMutation(changeSourceCourse(apiOrigin, queryClient));
  const [editing, setEditing] = useState(false);
  if (!source) return null;
  const bound = courses.find((course) => course.id === source.courseId);
  const reading =
    source.extraction === "running" || source.extraction === "pending";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    change.mutate(
      { id: sourceId, course: courseChoiceFrom(event.currentTarget) },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Kurs:{" "}
          {bound
            ? `${bound.code ? `${bound.code} ` : ""}${bound.title}`
            : "automatisch erkannt"}
        </span>
        {source.status === "ready" && !reading && !editing && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              change.reset();
              setEditing(true);
            }}
          >
            Kurs ändern
          </Button>
        )}
      </div>
      {change.isSuccess && (
        <p role="status">
          Wird neu gelesen. Was nunio darin findet, ersetzt danach die
          bisherigen Ergebnisse.
        </p>
      )}
      {editing && (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          <CourseChoiceFields
            courses={courses}
            defaultCourseId={bound?.id ?? null}
            disabled={change.isPending}
          />
          <p className="text-base-500">
            nunio liest die Quelle dafür neu; das zählt zu deinem KI-Kontingent.
          </p>
          {change.error && <p role="alert">{change.error.message}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={change.isPending}>
              Neu lesen
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={change.isPending}
              onClick={() => setEditing(false)}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
