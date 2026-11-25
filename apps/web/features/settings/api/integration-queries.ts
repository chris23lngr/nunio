import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Integration =
  paths["/api/me/integrations"]["get"]["responses"][200]["content"]["application/json"]["integrations"][number];

export function integrationQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "integrations"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/integrations",
        { signal },
      );
      if (!result.data) throw new Error("Could not load the integrations.");
      return result.data.integrations;
    },
  });
}
