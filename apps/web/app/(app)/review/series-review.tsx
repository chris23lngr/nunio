"use client";

import type { paths } from "@nunio/api-client";
import { createApiClient } from "@nunio/api-client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import { useEffect, useState } from "react";

type Series =
  paths["/api/me/plan"]["get"]["responses"][200]["content"]["application/json"]["eventSeries"][number];
type Course =
  paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
type Decision = { courseId: string } | { reject: true };

/**
 * The calendar's Event Series still to decide on (ADR-0021): nunio's proposed Course, another one, or none. Only a
 * confirmed series' events become Course Events.
 */
export function SeriesReview({ apiOrigin }: { apiOrigin: string }) {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const failed = "Kalender-Serien konnten nicht geladen werden.";
    void (async () => {
      try {
        const client = createApiClient(apiOrigin);
        const [plan, review] = await Promise.all([
          client.GET("/api/me/plan"),
          client.GET("/api/me/review"),
        ]);
        if (cancelled) return;
        if (!plan.data || !review.data) return setError(failed);
        setSeries(plan.data.eventSeries);
        setCourses(
          review.data.courses.filter((course) => course.status !== "rejected"),
        );
      } catch {
        if (!cancelled) setError(failed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiOrigin, version]);

  async function decide(id: string, decision: Decision) {
    setBusy(true);
    setError(null);
    try {
      const { response } = await createApiClient(apiOrigin).POST(
        "/api/me/event-series/{id}/decision",
        { params: { path: { id } }, body: decision },
      );
      if (!response.ok) throw new Error();
    } catch {
      setError("Deine Entscheidung wurde nicht gespeichert.");
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }

  const open = (series ?? []).filter((s) => s.state !== "confirmed");
  if (!open.length && !error) return null;
  const titleOf = (id: string | null) =>
    courses.find((course) => course.id === id)?.title;
  return (
    <section aria-labelledby="series-title">
      <h2 id="series-title">Kalender-Serien</h2>
      <p>
        Gehören diese Termine zu einem deiner Kurse? Erst bestätigte Termine
        bekommen Vor- und Nachbereitung.
      </p>
      {error && <p role="alert">{error}</p>}
      {open.map((s) => {
        const courseId = chosen[s.id] ?? s.courseId;
        return (
          <fieldset key={s.id}>
            <legend>{s.title}</legend>
            {s.state === "proposed" && <p>Vorschlag: {titleOf(s.courseId)}</p>}
            {s.state === "rejected" && <p>Kein Kurs</p>}
            <Select
              value={courseId}
              onValueChange={(value) => {
                if (value) setChosen((all) => ({ ...all, [s.id]: value }));
              }}
              items={courses.map((course) => ({
                value: course.id,
                label: course.title,
              }))}
            >
              <SelectTrigger aria-label="Kurs">
                <SelectValue placeholder="Kurs wählen" />
              </SelectTrigger>
              <SelectContent
                align="start"
                sideOffset={8}
                alignItemWithTrigger={false}
              >
                <SelectGroup>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>{" "}
            <button
              type="button"
              disabled={busy || !courseId}
              onClick={() => {
                if (courseId) void decide(s.id, { courseId });
              }}
            >
              Bestätigen
            </button>
            {s.state !== "rejected" && (
              <>
                {" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void decide(s.id, { reject: true });
                  }}
                >
                  Kein Kurs
                </button>
              </>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}
