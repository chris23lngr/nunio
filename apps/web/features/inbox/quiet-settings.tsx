"use client";

import { useState } from "react";
import { asMinute, asTime } from "@/lib/time";
import { useOutreachSettings } from "./use-outreach-settings";

const suggested = { fromMinute: 22 * 60, toMinute: 7 * 60 };

/**
 * Quiet Hours, when nothing leaves the app, and the daily limit on alerts. Both only hold back email and
 * push: the Inbox always shows everything at once.
 */
export function QuietSettings({ apiOrigin }: { apiOrigin: string }) {
  const { query, update } = useOutreachSettings(apiOrigin);
  const [draft, setDraft] = useState<{ from: string; until: string } | null>(
    null,
  );
  const [limit, setLimit] = useState<string | null>(null);
  if (!query.data)
    return query.error ? <p role="alert">{query.error.message}</p> : null;
  const { quietHours, dailyLimit } = query.data;
  const editing =
    draft ??
    (quietHours && {
      from: asTime(quietHours.fromMinute),
      until: asTime(quietHours.toMinute),
    }) ??
    null;
  return (
    <section aria-label="Quiet Hours and alerts">
      <h2>Quiet Hours</h2>
      {update.error && <p role="alert">{update.error.message}</p>}
      <p>
        In Quiet Hours nunio sends no email or notification; what comes up waits
        until they end. Your Inbox always shows it at once.
      </p>
      {editing === null ? (
        <button
          type="button"
          onClick={() =>
            setDraft({
              from: asTime(suggested.fromMinute),
              until: asTime(suggested.toMinute),
            })
          }
        >
          Turn Quiet Hours on
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(
              {
                quietHours: {
                  fromMinute: asMinute(editing.from),
                  toMinute: asMinute(editing.until),
                },
              },
              { onSuccess: () => setDraft(null) },
            );
          }}
        >
          <label>
            Quiet from
            <input
              type="time"
              required
              value={editing.from}
              onChange={(event) =>
                setDraft({ ...editing, from: event.target.value })
              }
            />
          </label>
          <label>
            until
            <input
              type="time"
              required
              value={editing.until}
              onChange={(event) =>
                setDraft({ ...editing, until: event.target.value })
              }
            />
          </label>
          <button type="submit" disabled={update.isPending}>
            Save Quiet Hours
          </button>
          {quietHours && (
            <button
              type="button"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { quietHours: null },
                  { onSuccess: () => setDraft(null) },
                )
              }
            >
              Turn Quiet Hours off
            </button>
          )}
        </form>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(
            { dailyLimit: Number(limit ?? dailyLimit) },
            { onSuccess: () => setLimit(null) },
          );
        }}
      >
        <label>
          At most this many alerts a day
          <input
            type="number"
            min={0}
            max={50}
            required
            value={limit ?? String(dailyLimit)}
            onChange={(event) => setLimit(event.target.value)}
          />
        </label>
        <button type="submit" disabled={update.isPending}>
          Save limit
        </button>
        <p>Briefings do not count; alerts past the limit wait in your Inbox.</p>
      </form>
    </section>
  );
}
