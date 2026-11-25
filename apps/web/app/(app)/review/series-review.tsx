"use client";

import { createApiClient } from "@nunio/api-client";
import { Button } from "@nunio/ui/components/button/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import { CalendarDays, Minus, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Calendar, Course, FixedEvent, Series } from "./review-format";
import { seriesSchedule } from "./review-format";

type Decision = { courseId: string } | { reject: true };
type Minutes = { preparationMinutes: number; followUpMinutes: number };

const clampMinutes = (value: number) =>
  Math.max(0, Math.min(1440, Number.isFinite(value) ? value : 0));

function MinuteStepper({
  label,
  ariaLabel,
  value,
  disabled,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const inputId = useId();
  return (
    <div className="flex w-[148px] shrink-0 flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[13px] leading-4.5 font-medium text-base-700"
      >
        {label}
      </label>
      <div className="flex h-8.5 items-center rounded-md bg-white outline-1 outline-base-300 focus-within:ring-2 focus-within:ring-primary-500">
        <button
          type="button"
          disabled={disabled || value <= 0}
          aria-label={`${label} verringern`}
          className="flex size-8.5 shrink-0 cursor-pointer items-center justify-center text-base-600 transition-colors hover:text-base-900 disabled:pointer-events-none disabled:opacity-40"
          onClick={() => onChange(clampMinutes(value - 15))}
        >
          <Minus aria-hidden="true" className="size-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 text-sm text-base-900 tabular-nums">
          <input
            id={inputId}
            type="number"
            min={0}
            max={1440}
            step={15}
            aria-label={ariaLabel}
            disabled={disabled}
            value={value}
            onChange={(event) =>
              onChange(clampMinutes(event.target.valueAsNumber || 0))
            }
            className="w-10 [appearance:textfield] bg-transparent text-right text-sm text-base-900 tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span aria-hidden="true" className="text-sm text-base-900">
            Min.
          </span>
        </div>
        <button
          type="button"
          disabled={disabled || value >= 1440}
          aria-label={`${label} erhöhen`}
          className="flex size-8.5 shrink-0 cursor-pointer items-center justify-center text-base-600 transition-colors hover:text-base-900 disabled:pointer-events-none disabled:opacity-40"
          onClick={() => onChange(clampMinutes(value + 15))}
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The calendar's Event Series still to decide on (ADR-0022): nunio's proposed Course, another one, or none. Only a
 * confirmed series' events become Course Events.
 */
export function SeriesReview({
  apiOrigin,
  courseColors = {},
  onChange,
}: {
  apiOrigin: string;
  courseColors?: Record<string, string>;
  onChange?: () => void;
}) {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [fixedEvents, setFixedEvents] = useState<FixedEvent[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState<Record<string, Minutes>>({});
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
        setSeries(plan.data.eventSeries ?? []);
        setFixedEvents(plan.data.fixedEvents ?? []);
        setCalendars(plan.data.calendars ?? []);
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

  async function decide(id: string, decision: Decision, routine?: Minutes) {
    setBusy(true);
    setError(null);
    try {
      const client = createApiClient(apiOrigin);
      const params = { path: { id } };
      const { response } = await client.POST(
        "/api/me/event-series/{id}/decision",
        { params, body: decision },
      );
      if (!response.ok) throw new Error();
      // The Routine follows the decision, so its Tasks land on Course Events.
      if (routine) {
        const set = await client.PUT("/api/me/event-series/{id}/routine", {
          params,
          body: routine,
        });
        if (!set.response.ok) throw new Error();
      }
      onChange?.();
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
    <section
      aria-labelledby="series-title"
      className="flex min-w-0 flex-1 flex-col gap-6"
    >
      <div className="flex flex-col gap-1.5 border-b border-base-200 pb-5">
        <h2
          id="series-title"
          className="text-xl leading-7 font-medium text-base-900"
        >
          Kalender-Serien
        </h2>
        <p className="text-sm text-base-600">
          Gehören diese Termine zu einem deiner Kurse? Erst bestätigte Termine
          bekommen Vor- und Nachbereitung.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-600">
          {error}
        </p>
      )}
      {open.length > 0 && (
        <div className="flex flex-col divide-y divide-base-200 overflow-hidden rounded-xl border border-base-200 bg-white">
          {open.map((s) => {
            const courseId = chosen[s.id] ?? s.courseId;
            const routine = minutes[s.id] ?? {
              preparationMinutes: s.routine?.preparationMinutes ?? 30,
              followUpMinutes: s.routine?.followUpMinutes ?? 60,
            };
            const schedule = seriesSchedule(s, fixedEvents, calendars);
            const proposedTitle = titleOf(s.courseId);
            const headingId = `series-${s.id}`;
            const swatch = courseId ? courseColors[courseId] : undefined;

            return (
              // biome-ignore lint/a11y/useSemanticElements: Flex layout breaks on fieldset in some engines; role="group" preserves the accessible group semantics.
              <div
                key={s.id}
                role="group"
                aria-labelledby={headingId}
                className="flex items-start gap-4 p-5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-base-100 text-base-700">
                  <CalendarDays aria-hidden="true" className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <h3
                        id={headingId}
                        className="text-[15px] leading-5.5 font-semibold text-base-900"
                      >
                        {s.title}
                      </h3>
                      {schedule && (
                        <p className="text-[13px] leading-4.5 text-base-600">
                          {schedule}
                        </p>
                      )}
                    </div>
                    {s.state === "proposed" && proposedTitle && (
                      <span className="inline-flex h-5.5 shrink-0 items-center rounded-full bg-primary-50 px-2 text-xs font-medium text-primary-800 outline-1 outline-primary-200">
                        Vorschlag: {proposedTitle}
                      </span>
                    )}
                    {s.state === "undecided" && (
                      <span className="inline-flex h-5.5 shrink-0 items-center rounded-full bg-base-100 px-2 text-xs font-medium text-base-700 outline-1 outline-base-200">
                        Kein Kurs erkannt
                      </span>
                    )}
                    {s.state === "rejected" && (
                      <span className="inline-flex h-5.5 shrink-0 items-center rounded-full bg-base-100 px-2 text-xs font-medium text-base-700 outline-1 outline-base-200">
                        Kein Kurs
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-44 flex-1 flex-col gap-1.5">
                      <span className="text-[13px] leading-4.5 font-medium text-base-700">
                        Kurs
                      </span>
                      <Select
                        value={courseId}
                        onValueChange={(value) => {
                          if (value)
                            setChosen((all) => ({ ...all, [s.id]: value }));
                        }}
                        items={courses.map((course) => ({
                          value: course.id,
                          label: course.title,
                        }))}
                      >
                        <SelectTrigger
                          aria-label="Kurs"
                          className="h-8.5 w-full"
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            {swatch && (
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: swatch }}
                              />
                            )}
                            <SelectValue
                              placeholder="Kurs wählen"
                              className="truncate"
                            />
                          </span>
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          sideOffset={8}
                          alignItemWithTrigger={false}
                        >
                          <SelectGroup>
                            {courses.map((course) => (
                              <SelectItem key={course.id} value={course.id}>
                                <span className="flex items-center gap-2">
                                  {courseColors[course.id] && (
                                    <span
                                      aria-hidden="true"
                                      className="size-2 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor:
                                          courseColors[course.id],
                                      }}
                                    />
                                  )}
                                  {course.title}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <MinuteStepper
                      label="Vorbereitung"
                      ariaLabel="Vorbereitung (Minuten)"
                      value={routine.preparationMinutes}
                      disabled={busy}
                      onChange={(preparationMinutes) =>
                        setMinutes((all) => ({
                          ...all,
                          [s.id]: { ...routine, preparationMinutes },
                        }))
                      }
                    />
                    <MinuteStepper
                      label="Nachbereitung"
                      ariaLabel="Nachbereitung (Minuten)"
                      value={routine.followUpMinutes}
                      disabled={busy}
                      onChange={(followUpMinutes) =>
                        setMinutes((all) => ({
                          ...all,
                          [s.id]: { ...routine, followUpMinutes },
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      disabled={busy || !courseId}
                      className="px-3"
                      onClick={() => {
                        if (courseId) void decide(s.id, { courseId }, routine);
                      }}
                    >
                      Bestätigen
                    </Button>
                    {s.state !== "rejected" && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        className="text-base-600"
                        onClick={() => {
                          void decide(s.id, { reject: true });
                        }}
                      >
                        Kein Kurs
                      </Button>
                    )}
                    <div className="flex-1" />
                    <span className="text-xs text-base-500">
                      in 15-Minuten-Schritten
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
