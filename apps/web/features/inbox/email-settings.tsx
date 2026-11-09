"use client";

import { useOutreachSettings } from "./use-outreach-settings";

/** Whether nunio emails the student; every email only points to the Inbox, which has everything either way. */
export function EmailSettings({ apiOrigin }: { apiOrigin: string }) {
  const { query, update } = useOutreachSettings(apiOrigin);
  if (!query.data)
    return query.error ? <p role="alert">{query.error.message}</p> : null;
  return (
    <section aria-label="Email">
      <h2>Email</h2>
      {update.error && <p role="alert">{update.error.message}</p>}
      <label>
        <input
          type="checkbox"
          checked={query.data.email}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ email: event.target.checked })}
        />
        Email me when something needs my attention
      </label>
      <label>
        <input
          type="checkbox"
          checked={query.data.briefingEmail}
          disabled={update.isPending || !query.data.email}
          onChange={(event) =>
            update.mutate({ briefingEmail: event.target.checked })
          }
        />
        Also email me my daily Briefing
      </label>
      <p>Emails only say how many items wait for you, never what they are.</p>
    </section>
  );
}
