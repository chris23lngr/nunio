import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import {
  changeSourceCourse,
  ReadingNotStarted,
  readSourceAgain,
} from "../api/source-mutations";
import { sourceQueries } from "../api/source-queries";
import {
  CourseChoiceFields,
  courseChoiceFrom,
  courseName,
} from "./course-choice-fields";

/**
 * The Course a Source is bound to, and "Kurs ändern", which reads a ready Source again under the new choice. A Source
 * left waiting, such as when that reading could not start, can be started here.
 */
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
  const courseList = useQuery(courseListQuery(apiOrigin));
  const courses = courseList.data?.courses ?? [];
  const change = useMutation(changeSourceCourse(apiOrigin, queryClient));
  const start = useMutation(readSourceAgain(apiOrigin, queryClient));
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState("");
  if (!source) return null;
  const bound = courses.find((course) => course.id === source.courseId);
  const ready = source.status === "ready";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    change.mutate(
      { id: sourceId, course: courseChoiceFrom(selected, event.currentTarget) },
      {
        onSuccess: () => setEditing(false),
        // The Course did change; what is left is starting the reading, offered below.
        onError: (error) => {
          if (error instanceof ReadingNotStarted) setEditing(false);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Kurs:{" "}
          {!source.courseId
            ? "automatisch erkannt"
            : bound
              ? courseName(bound)
              : "wird geladen …"}
        </span>
        {/* Only once the Courses are loaded, so the current choice shows and keeping it never unbinds. */}
        {ready &&
          source.extraction !== "running" &&
          source.extraction !== "pending" &&
          courseList.isSuccess &&
          !editing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                change.reset();
                setSelected(bound?.id ?? "");
                setEditing(true);
              }}
            >
              Kurs ändern
            </Button>
          )}
      </div>
      {ready && source.extraction === "running" && (
        <p role="status">Wird gerade gelesen …</p>
      )}
      {change.isSuccess && source.extraction !== "running" ? (
        <p role="status">
          Wird neu gelesen. Was nunio darin findet, ersetzt danach die
          bisherigen Ergebnisse.
        </p>
      ) : (
        ready &&
        source.extraction === "pending" && (
          <div className="flex flex-wrap items-center gap-3">
            <span>Wartet darauf, gelesen zu werden.</span>
            <Button
              type="button"
              variant="outline"
              disabled={start.isPending}
              onClick={() => {
                change.reset();
                start.mutate(sourceId);
              }}
            >
              Lesen starten
            </Button>
          </div>
        )
      )}
      {start.isError && (
        <p role="alert">
          Das Lesen konnte nicht starten. Bitte versuche es erneut.
        </p>
      )}
      {!editing && change.error && <p role="alert">{change.error.message}</p>}
      {editing && (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          <CourseChoiceFields
            courses={courses}
            current={bound}
            selected={selected}
            onSelect={setSelected}
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
