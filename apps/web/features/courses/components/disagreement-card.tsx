import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { createApiClient } from "@/lib/api-client";
import type { CoursePage } from "../api/course-queries";
import { coursePageQuery } from "../api/course-queries";

type Disagreement = CoursePage["disagreements"][number];

/** Each exam logistics field by name, what one value and its values together are called; unknown ones fall back. */
const fields: Record<string, { title: string; value: string; values: string }> =
  {
    "exam.room": { title: "Klausurraum", value: "Raum", values: "Räume" },
    "exam.duration": {
      title: "Klausurdauer",
      value: "Dauer",
      values: "Zeiten",
    },
    "exam.aids": {
      title: "Hilfsmittel",
      value: "Hilfsmittel",
      values: "Hilfsmittel",
    },
    "exam.format": {
      title: "Prüfungsform",
      value: "Prüfungsform",
      values: "Prüfungsformen",
    },
  };

const list = new Intl.ListFormat("de", { type: "conjunction" });

/** A due date as the student reads it: "20.11." with ", 12:00 Uhr" when it has a time. */
function dueText(due: { date: string | null; time: string | null }) {
  if (!due.date) return "ohne Datum";
  const [, month, day] = due.date.split("-");
  return `${day}.${month}.${due.time ? `, ${due.time} Uhr` : ""}`;
}

/** What the Disagreement asks, which Sources disagree, and each value to use. */
function shapeOf(disagreement: Disagreement) {
  const values =
    disagreement.kind === "fact"
      ? disagreement.values.map((v) => ({ text: v.value, ...v }))
      : disagreement.values.map((v) => ({ text: dueText(v.due), ...v }));
  const field: { title: string; value?: string; values: string } =
    disagreement.kind === "fact"
      ? (fields[disagreement.key] ?? {
          title: disagreement.key,
          values: "Angaben",
        })
      : { title: disagreement.title, value: "Termin", values: "Termine" };
  return {
    question: `${field.title}: ${values.map((v) => v.text).join(" oder ")}?`,
    sources: `${list.format([...new Set(values.flatMap((v) => v.sources))])} nennen verschiedene ${field.values}`,
    values: values.map((v) => ({
      ...v,
      label: field.value ? `${field.value} ${v.text}` : `„${v.text}“`,
    })),
  };
}

/** The Course's open Disagreements, one at a time, the next ones stacked behind; using a value resolves it. */
export function DisagreementCard({
  apiOrigin,
  courseId,
  disagreements,
}: {
  apiOrigin: string;
  courseId: string;
  disagreements: Disagreement[];
}) {
  const queryClient = useQueryClient();
  const use = useMutation({
    mutationFn: async ({
      kind,
      id,
      extractionId,
    }: {
      kind: Disagreement["kind"];
      id: string;
      extractionId: string;
    }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/review/{kind}/{id}/use",
        { params: { path: { kind, id } }, body: { extractionId } },
      );
      if (!result.data)
        throw new Error("Das hat nicht geklappt. Versuche es noch einmal.");
    },
    onSuccess: () =>
      queryClient.invalidateQueries(coursePageQuery(apiOrigin, courseId)),
  });
  const [current] = disagreements;
  if (!current) return null;
  const { question, sources, values } = shapeOf(current);
  return (
    <section aria-label="Abweichungen" className="relative">
      {disagreements.length > 1 && (
        <div
          aria-hidden="true"
          className="absolute inset-x-3 top-3.5 -bottom-2 rounded-lg bg-white shadow-sm outline outline-base-700/15"
        />
      )}
      <div className="relative flex flex-col rounded-lg bg-white p-6 shadow-sm outline outline-base-700/15">
        <h2 className="flex items-center gap-2 text-sm font-medium text-base-800">
          <TriangleAlert
            aria-hidden="true"
            className="size-4 shrink-0 text-[oklch(70.5%_0.213_47.6)]"
          />
          {question}
        </h2>
        <p className="mt-0.5 pl-6 text-sm text-base-600">{sources}</p>
        <div className="mt-4 flex flex-wrap gap-3 pl-6">
          {values.map((value) => (
            <Button
              key={value.extractionId}
              variant="outline"
              disabled={use.isPending}
              onClick={() =>
                use.mutate({
                  kind: current.kind,
                  id: current.id,
                  extractionId: value.extractionId,
                })
              }
            >
              {value.label} verwenden
            </Button>
          ))}
        </div>
        {use.error && (
          <p role="alert" className="mt-3 pl-6 text-sm text-destructive-600">
            {use.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
