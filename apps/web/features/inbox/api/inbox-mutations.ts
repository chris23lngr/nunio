import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import type { RunApproval } from "@/features/agents/api/activity-mutations";
import { approvalQueries } from "@/features/approvals/api/approval-queries";
import { createApiClient } from "@/lib/api-client";
import { inboxQueries } from "./inbox-queries";

/** Why nothing was approved, by the API's 409 error. */
const unapproved: Record<string, string> = {
  changed:
    "Diese Aktion hat sich geändert, seit dein Agent gefragt hat. Nichts wurde ausgeführt; deine Inbox wurde neu geladen.",
  expired: "Diese Freigabe ist abgelaufen. Nichts wurde ausgeführt.",
};

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

/** Approves or denies an Approval card shown inside a Briefing (ADR-0010, #188). */
export function decideInboxApproval(
  apiOrigin: string,
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
                "Diese Freigabe wurde schon beantwortet oder hat sich geändert. Deine Inbox wurde neu geladen.")
            : "Deine Entscheidung konnte nicht gespeichert werden.",
        );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: inboxQueries(apiOrigin).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: approvalQueries(apiOrigin).queryKey,
        }),
      ]),
  });
}
