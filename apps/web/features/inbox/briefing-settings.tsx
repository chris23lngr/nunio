"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { settingsQueries, updateSettings } from "./api/settings-queries";

const defaultMinute = 7 * 60;
const asTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const asMinute = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
};

/** When the daily Briefing comes, in the time zone of the student's Plan, or that it does not. */
export function BriefingSettings({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(settingsQueries(apiOrigin));
  const update = useMutation(updateSettings(apiOrigin, queryClient));
  const [time, setTime] = useState<string | null>(null);
  if (!query.data)
    return query.error ? <p role="alert">{query.error.message}</p> : null;
  const at = query.data.briefingAtMinute;
  const shown = time ?? asTime(at ?? defaultMinute);
  return (
    <section aria-label="Briefing settings">
      <h2>Daily Briefing</h2>
      {update.error && <p role="alert">{update.error.message}</p>}
      {at === null ? (
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate({ briefingAtMinute: asMinute(shown) })}
        >
          Turn Briefings on
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({ briefingAtMinute: asMinute(shown) });
          }}
        >
          <label>
            Daily Briefing at
            <input
              type="time"
              required
              value={shown}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <button type="submit" disabled={update.isPending}>
            Save
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ briefingAtMinute: null })}
          >
            Turn Briefings off
          </button>
        </form>
      )}
    </section>
  );
}
