import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { approvalQueries } from "@/features/approvals/api/approval-queries";
import { createApiClient } from "@/lib/api-client";
import type { ActivityRunDetail } from "./activity-queries";
import { runsKey } from "./activity-queries";

export type RunApproval = ActivityRunDetail["approvals"][number];

/** Why nothing was approved, by the API's 409 error. */
const unapproved: Record<string, string> = {
  changed:
    "Diese Aktion hat sich geändert, seit dein Agent gefragt hat. Nichts wurde ausgeführt; die Freigaben wurden neu geladen.",
  expired: "Diese Freigabe ist abgelaufen. Nichts wurde ausgeführt.",
};

/**
 * Approves exactly the Action a Run's card showed, by its fingerprint (ADR-0010), or denies it. Whatever the answer,
 * the Agent's Runs are read again, so a card the gate no longer holds open goes and the Verlauf shows the decision.
 */
export function decideRunApproval(
  apiOrigin: string,
  agentId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async ({
      approval,
      decision,
    }: {
      approval: RunApproval;
      decision: "approve" | "deny";
    }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/approvals/{actionId}",
        {
          params: { path: { actionId: approval.actionId } },
          body:
            decision === "approve"
              ? { decision, fingerprint: approval.fingerprint }
              : { decision },
        },
      );
      if (!result.data)
        throw new Error(
          result.response.status === 409
            ? (unapproved[result.error?.error ?? ""] ??
                "Diese Freigabe wurde schon beantwortet oder hat sich geändert. Die Freigaben wurden neu geladen.")
            : "Deine Entscheidung konnte nicht gespeichert werden.",
        );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: runsKey(apiOrigin, agentId),
        }),
        queryClient.invalidateQueries({
          queryKey: approvalQueries(apiOrigin).queryKey,
        }),
      ]),
  });
}
