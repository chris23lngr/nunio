import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";
import type { Approval } from "./approval-queries";
import { approvalQueries, unconfirmedQueries } from "./approval-queries";

/** Approves exactly the Action the card showed, by its fingerprint (ADR-0010), or denies it. */
export function decideApproval(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async ({
      approval,
      decision,
    }: {
      approval: Approval;
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
            ? "This request changed or expired. Look at it again before deciding."
            : "Could not record your decision.",
        );
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: approvalQueries(apiOrigin).queryKey,
      }),
  });
}

/** Only the student resolves an Action nunio could not confirm; nunio never retries it. */
export function resolveUnconfirmed(
  apiOrigin: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async ({
      actionId,
      resolution,
    }: {
      actionId: string;
      resolution: "happened" | "did_not_happen";
    }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/actions/{actionId}/resolve",
        {
          params: { path: { actionId } },
          body: { resolution },
        },
      );
      if (!result.data) throw new Error("Could not record what happened.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: unconfirmedQueries(apiOrigin).queryKey,
      }),
  });
}
