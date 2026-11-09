import type { paths } from "@nunio/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type OutreachSettings =
  paths["/api/me/outreach-settings"]["get"]["responses"][200]["content"]["application/json"];

export function settingsQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "outreach-settings"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/outreach-settings",
        { signal },
      );
      if (!result.data) throw new Error("Could not load your settings.");
      return result.data;
    },
  });
}

export function updateSettings(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (patch: Partial<OutreachSettings>) => {
      const result = await createApiClient(apiOrigin).PATCH(
        "/api/me/outreach-settings",
        { body: patch },
      );
      if (!result.data) throw new Error("Could not save your settings.");
      return result.data;
    },
    onSuccess: (settings) =>
      queryClient.setQueryData(settingsQueries(apiOrigin).queryKey, settings),
  });
}
