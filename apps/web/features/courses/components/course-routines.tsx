"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useState } from "react";
import type { Plan } from "@/features/plan/api/plan-queries";

type Series = Plan["eventSeries"][number];
type Minutes = { preparationMinutes: number; followUpMinutes: number };

/**
 * A Course's calendar series and their Routines (ADR-0022): how long to prepare for and follow up on each lecture,
 * and skipping the Routine for a while.
 */
export function CourseRoutines({
  series,
  error,
  onSave,
  onSkip,
}: {
  series: Series[];
  error: string | null;
  onSave: (seriesId: string, minutes: Minutes) => void;
  onSkip: (seriesId: string, until: Date) => void;
}) {
  if (!series.length) return null;
  return (
    <section
      aria-label="Termine & Routinen"
      className="flex flex-col gap-3 border-t border-base-200 pt-3"
    >
      <h3 className="text-sm font-medium text-base-700">Termine & Routinen</h3>
      {series.map((s) => (
        <SeriesRoutine key={s.id} series={s} onSave={onSave} onSkip={onSkip} />
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive-700">
          {error}
        </p>
      )}
    </section>
  );
}

function SeriesRoutine({
  series,
  onSave,
  onSkip,
}: {
  series: Series;
  onSave: (seriesId: string, minutes: Minutes) => void;
  onSkip: (seriesId: string, until: Date) => void;
}) {
  const [minutes, setMinutes] = useState<Minutes>({
    preparationMinutes: series.routine?.preparationMinutes ?? 0,
    followUpMinutes: series.routine?.followUpMinutes ?? 0,
  });
  const [through, setThrough] = useState("");
  const field = (key: keyof Minutes, label: string) => (
    <label className="flex items-center gap-2 text-sm text-base-600">
      {label}
      <input
        type="number"
        min={0}
        max={1440}
        step={15}
        value={minutes[key]}
        onChange={(event) =>
          setMinutes({ ...minutes, [key]: event.target.valueAsNumber || 0 })
        }
        className="w-20 rounded-md border border-base-200 px-2 py-1 text-base-800"
      />
    </label>
  );
  const skipped = series.routine?.skippedUntil
    ? new Date(series.routine.skippedUntil)
    : null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm text-base-800">{series.title}</legend>
      {skipped && skipped > new Date() && (
        <p className="text-xs text-base-500">
          Ausgesetzt bis {skipped.toLocaleDateString("de-DE")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {field("preparationMinutes", "Vorbereitung (Minuten)")}
        {field("followUpMinutes", "Nachbereitung (Minuten)")}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSave(series.id, minutes)}
        >
          Speichern
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-base-600">
          Aussetzen bis
          <input
            type="date"
            value={through}
            onChange={(event) => setThrough(event.target.value)}
            className="rounded-md border border-base-200 px-2 py-1 text-base-800"
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={!through}
          onClick={() => {
            // Through that day: lectures beginning before the next local midnight get nothing.
            const [year, month, day] = through.split("-").map(Number);
            onSkip(series.id, new Date(year!, month! - 1, day! + 1));
          }}
        >
          Aussetzen
        </Button>
      </div>
    </fieldset>
  );
}
