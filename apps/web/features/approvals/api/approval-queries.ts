import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Approval =
  paths["/api/me/approvals"]["get"]["responses"][200]["content"]["application/json"][number];

export function approvalQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "approvals"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/approvals", {
        signal,
      });
      if (!result.data)
        throw new Error("Could not load what nunio is asking you.");
      return result.data;
    },
  });
}

export type Unconfirmed =
  paths["/api/me/actions/unconfirmed"]["get"]["responses"][200]["content"]["application/json"][number];

export function unconfirmedQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "unconfirmed"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/actions/unconfirmed",
        { signal },
      );
      if (!result.data)
        throw new Error("Could not load what nunio could not confirm.");
      return result.data;
    },
  });
}
