import { cn } from "@nunio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Upload } from "lucide-react";
import Link from "next/link";
import type { ChangeEvent } from "react";
import { useId, useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { uploadSource } from "@/features/sources/api/source-mutations";
import type { Source } from "@/features/sources/api/source-queries";
import { sourceQueries } from "@/features/sources/api/source-queries";
import {
  CourseChoiceFields,
  courseChoiceFrom,
} from "@/features/sources/components/course-choice-fields";
import { homeQuery } from "../api/home-queries";
import { SectionHeading } from "./item-card";

const failures: Record<NonNullable<Source["failure"]>, string> = {
  too_many_pages:
    "Verarbeitung gestoppt: mehr als 100 Seiten. Lösch die Quelle und lad sie in Teilen hoch.",
  too_large:
    "Verarbeitung gestoppt: mehr Inhalt, als eine Quelle fassen kann. Lösch sie und lad sie in kleineren Teilen hoch.",
  unreadable:
    "Verarbeitung gestoppt: Die Datei ließ sich nicht lesen. Speichere sie als neues PDF.",
  no_text: "Verarbeitung gestoppt: kein lesbarer Text im PDF.",
  allowance_exhausted:
    "Verarbeitung gestoppt: Dein KI-Kontingent ist aufgebraucht. Wende dich an den Support.",
};
const extraction: Record<Source["extraction"], string> = {
  pending: "Bereit · wartet aufs Lesen",
  running: "Bereit · wird fürs Prüfen gelesen",
  done: "Bereit · bereit zum Prüfen",
  failed: "Bereit · konnte nicht fürs Prüfen gelesen werden",
};

/** A Source's status in a word or two, and the color of its dot. */
function status(source: Source): { text: string; dot: string; failed?: true } {
  if (source.status === "failed")
    return {
      text: source.failure
        ? failures[source.failure]
        : "Verarbeitung gestoppt. Wende dich an den Support, bevor du es erneut versuchst.",
      dot: "bg-destructive-500",
      failed: true,
    };
  if (source.status === "ready")
    return {
      text: extraction[source.extraction],
      dot: source.extraction === "failed" ? "bg-warning-500" : "bg-success-500",
    };
  return {
    text: {
      uploading: "Wartet auf den Upload",
      queued: "Wartet auf die Verarbeitung",
      processing: "Wird verarbeitet",
      deleted: "Gelöscht",
    }[source.status],
    dot: source.status === "deleted" ? "bg-base-400" : "bg-primary-500",
  };
}

/** Uploading a Source to a Course or "Automatisch erkennen", and the three newest Sources; the rest live under /sources. */
export function SourcesCard({ apiOrigin }: { apiOrigin: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const sources = useQuery(sourceQueries(apiOrigin));
  const courses = useQuery(courseListQuery(apiOrigin)).data?.courses ?? [];
  const upload = useMutation(uploadSource(apiOrigin, queryClient));
  const [course, setCourse] = useState("");
  // The list is oldest first.
  const newest = (sources.data ?? []).slice(-3).reverse();

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    if (!files.length || !input.form) return;
    upload.mutate(
      {
        files,
        course: courseChoiceFrom(course, input.form),
        done: new WeakSet(),
        // A later upload binds to the Course this one created instead of creating another.
        onCourse: setCourse,
      },
      {
        onSuccess: () => setCourse(""),
        onSettled: () => {
          input.value = "";
          void queryClient.invalidateQueries(homeQuery(apiOrigin));
        },
      },
    );
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeading
        id={id}
        title="Quellen"
        link={{ href: "/sources", label: "Alle Quellen" }}
      />
      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-col gap-3 rounded-xl border border-dashed border-base-300 bg-base-50 p-4"
      >
        {/* The input covers the row, so a PDF dropped on it is chosen as if picked. */}
        <div className="relative flex items-center gap-3 rounded-lg focus-within:outline-2 focus-within:outline-primary-500">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-base-700 outline-1 outline-base-200"
          >
            <Upload className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-base-900">
              {upload.isPending ? (
                "PDF wird hochgeladen …"
              ) : (
                <>
                  PDF hierher ziehen oder{" "}
                  <span className="text-primary-700">auswählen</span>
                </>
              )}
            </span>
            <span className="text-xs text-base-600">
              Auch Scans · bis 20 MB und 100 Seiten
            </span>
          </span>
          <input
            name="source"
            type="file"
            aria-label="PDF hochladen"
            accept="application/pdf,.pdf"
            multiple
            disabled={upload.isPending}
            onChange={choose}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>
        {/* One choice for every file of the next upload. */}
        <CourseChoiceFields
          courses={courses}
          selected={course}
          onSelect={setCourse}
          disabled={upload.isPending}
        />
        {upload.error && (
          <p role="alert" className="text-sm text-destructive-700">
            {upload.error.message}
          </p>
        )}
      </form>
      {sources.error && (
        <p role="alert" className="text-sm text-destructive-700">
          {sources.error.message}
        </p>
      )}
      {newest.length > 0 && (
        <ul className="border-t border-base-700/10">
          {newest.map((source) => {
            const shown = status(source);
            return (
              <li
                key={source.id}
                className="flex items-start gap-2 border-b border-base-700/10 px-2 py-3"
              >
                <File
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-base-600"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    href={`/sources/${source.id}`}
                    className="text-sm font-medium text-base-900 hover:underline"
                  >
                    {source.title}
                  </Link>
                  <span
                    className={cn(
                      "flex items-start gap-1.5 text-xs",
                      shown.failed ? "text-destructive-800" : "text-base-600",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.25 size-1.5 shrink-0 rounded-full",
                        shown.dot,
                      )}
                    />
                    {shown.text}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
