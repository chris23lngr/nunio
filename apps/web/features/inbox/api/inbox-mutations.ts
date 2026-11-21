import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";
import { inboxQueries } from "./inbox-queries";

/** Acknowledging means noted; dismissing means it was not useful. Either closes the Intervention. */
export function closeIntervention(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async ({
      id,
      as,
    }: {
      id: string;
      as: "acknowledged" | "dismissed";
    }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/interventions/{id}",
        { params: { path: { id } }, body: { as } },
      );
      if (!result.data)
        throw new Error(
          result.response.status === 409
            ? "This was already closed."
            : "Could not record that.",
        );
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: inboxQueries(apiOrigin).queryKey,
      }),
  });
}

/** Opening a Notice marks it read; an announcement of it not yet sent then no longer goes out. */
export function readNotice(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/notices/{id}/read",
        { params: { path: { id } } },
      );
      if (!result.data) throw new Error("Konnte die Nachricht nicht öffnen.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: inboxQueries(apiOrigin).queryKey,
      }),
  });
}
