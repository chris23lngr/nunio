"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decideApproval, resolveUnconfirmed } from "./api/approval-mutations";
import { approvalQueries, unconfirmedQueries } from "./api/approval-queries";
import { ApprovalCard } from "./components/approval-card";
import { UnconfirmedCard } from "./components/unconfirmed-card";

/** What nunio is waiting for the student to approve; nothing happens until they confirm the exact Action. */
export function ApprovalsPanel({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(approvalQueries(apiOrigin));
  const decide = useMutation(decideApproval(apiOrigin, queryClient));
  const resolve = useMutation(resolveUnconfirmed(apiOrigin, queryClient));
  const approvals = query.data ?? [];
  const unconfirmed = useQuery(unconfirmedQueries(apiOrigin)).data ?? [];
  const error = decide.error ?? resolve.error;
  if (!approvals.length && !unconfirmed.length && !error) return null;
  return (
    <section aria-label="Waiting for you">
      <h2>Waiting for you</h2>
      {error && <p role="alert">{error.message}</p>}
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.actionId}
          approval={approval}
          busy={decide.isPending}
          onDecide={(decision) => decide.mutate({ approval, decision })}
        />
      ))}
      {unconfirmed.map((item) => (
        <UnconfirmedCard
          key={item.actionId}
          unconfirmed={item}
          busy={resolve.isPending}
          onResolve={(resolution) =>
            resolve.mutate({ actionId: item.actionId, resolution })
          }
        />
      ))}
    </section>
  );
}
