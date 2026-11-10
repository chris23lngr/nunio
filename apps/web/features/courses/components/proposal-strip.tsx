import { Button } from "@nunio/ui/components/button/button";
import type { CourseSummary } from "../api/course-queries";

/** Courses nunio read from the student's Sources, waiting for the student to accept or reject them. */
export function ProposalStrip({
  proposals,
  pending,
  error,
  onDecide,
}: {
  proposals: CourseSummary[];
  pending: boolean;
  error: string | null;
  onDecide: (course: CourseSummary, decision: "accept" | "reject") => void;
}) {
  return (
    <section
      aria-labelledby="course-proposals"
      className="mt-10 rounded-xl bg-base-50 p-6"
    >
      <h2 id="course-proposals" className="text-sm font-medium text-base-800">
        Von nunio erkannt
      </h2>
      <p className="mt-1 text-sm text-base-600">
        Diese Kurse stehen in deinen Quellen. Nimm an, was du belegst.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {proposals.map((course) => (
          <li key={course.id} className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-base-800">
              {course.code ? `${course.code} · ${course.title}` : course.title}
            </span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => onDecide(course, "accept")}
            >
              Annehmen
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onDecide(course, "reject")}
            >
              Ablehnen
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive-700">
          {error}
        </p>
      )}
    </section>
  );
}
