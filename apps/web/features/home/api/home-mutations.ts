import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { planQuery } from "@/features/plan/api/plan-queries";
import { createApiClient } from "@/lib/api-client";
import { homeQuery } from "./home-queries";

/** Skips a Routine until a deadline, as a Shortfall's tradeoff offers (ADR-0022). */
export function skipRoutine(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async ({
      routine,
      until,
    }: {
      routine: string;
      until: string;
    }) => {
      const { response } = await createApiClient(apiOrigin).POST(
        "/api/me/event-series/{id}/routine/skip",
        { params: { path: { id: routine } }, body: { until } },
      );
      if (!response.ok)
        throw new Error(
          "Die Vor- und Nachbereitung konnte nicht ausgesetzt werden.",
        );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(homeQuery(apiOrigin)),
        queryClient.invalidateQueries(planQuery(apiOrigin)),
      ]),
  });
}
