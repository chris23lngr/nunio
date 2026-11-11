import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Plan =
  paths["/api/me/plan"]["get"]["responses"][200]["content"]["application/json"];
export type PlanMove = Plan["proposal"]["moves"][number];

/** The student's Plan, the proposal nunio would make now, and the Limits it plans within. */
export function planQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "plan"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/plan", {
        signal,
      });
      if (!result.data)
        throw new Error("Dein Plan konnte nicht geladen werden.");
      return result.data;
    },
  });
}
