import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Home =
  paths["/api/me/home"]["get"]["responses"][200]["content"]["application/json"];
export type Attention = Home["attention"][number];

/** The actionable day: what needs the student, what is ready, and what is still running. */
export function homeQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "home"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/home", {
        signal,
      });
      if (!result.data)
        throw new Error("Dein Tag konnte nicht geladen werden.");
      return result.data;
    },
    refetchInterval: 15_000,
  });
}
