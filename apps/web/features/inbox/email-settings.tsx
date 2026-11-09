"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsQueries, updateSettings } from "./api/settings-queries";

/** Whether nunio emails the student; every email only points to the Inbox, which has everything either way. */
export function EmailSettings({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(settingsQueries(apiOrigin));
  const update = useMutation(updateSettings(apiOrigin, queryClient));
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
      <p>Emails only say how many items wait for you, never what they are.</p>
    </section>
  );
}
