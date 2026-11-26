import { randomUUID } from "node:crypto";
import type { Transaction } from "@nunio/delegation";
import { openApprovalAt, runCaps } from "@nunio/delegation";
import type { Sealed } from "@nunio/knowledge";
import { causeOf } from "./causes.js";
import type { BriefingItems } from "./outreach.js";
import { openIntervention } from "./outreach.js";
import { channels } from "./raise.js";

/** Why an Agent's Run wrote no Briefing. */
export type BriefingRefusal =
  | "run_ended"
  | "paused"
  | "ended"
  | "no_capability"
  | "run_cap"
  | "nothing_open";

/** What a Briefing's text is sealed for, so it opens only as this Run's Briefing. */
export const briefingTextId = (runId: string) => `${runId}:briefing`;

/** The Inbox item IDs an Agent's Briefing bundles. */
export type BriefingBundle = {
  interventions: string[];
  approvals: string[];
  notices: string[];
  artifacts: string[];
};

const unique = (ids: string[]) => [...new Set(ids)];

/**
 * Writes the Briefing an Agent's Run composed (#146), its text sealed for `briefingTextId(runId)`: only while the Run
 * is under way and its Agent active and still holding "Briefing erstellen", at most one per Run (ADR-0026), and only
 * when at least one bundled Inbox item is currently open. It goes to the Inbox and is queued on each channel, to be
 * announced under Notice rules (ADR-0014): outside Quiet Hours and sharing the daily limit with Interventions and
 * Notices. Runs in the caller's transaction, serialised with ending the Run.
 */
export async function sendBriefing(
  tx: Transaction,
  runId: string,
  briefing: { text: Sealed; items: BriefingBundle },
  at: Date,
): Promise<
  | { status: "written"; briefingId: string }
  | { status: "refused"; reason: BriefingRefusal }
> {
  const refuse = (reason: BriefingRefusal) =>
    ({ status: "refused", reason }) as const;
  await tx.$executeRaw`SELECT 1 FROM "run" WHERE "id" = ${runId} FOR UPDATE`;
  const run = await tx.run.findUniqueOrThrow({
    where: { id: runId },
    include: { agent: { include: { capabilities: true } }, briefing: true },
  });
  if (run.status !== "running" || !run.agent) return refuse("run_ended");
  if (run.agent.state !== "active") return refuse(run.agent.state);
  if (!run.agent.capabilities.some((c) => c.capability === "createBriefing"))
    return refuse("no_capability");
  if ((run.briefing ? 1 : 0) >= runCaps.briefings) return refuse("run_cap");

  const items: BriefingItems = {
    interventions: unique(briefing.items.interventions),
    approvals: unique(briefing.items.approvals),
    agents: [],
    notices: unique(briefing.items.notices),
    artifacts: unique(briefing.items.artifacts),
  };

  const hasOpenArtifact = async (): Promise<boolean> => {
    if (!items.artifacts?.length) return false;
    const rows = await tx.artifact.findMany({
      where: {
        id: { in: items.artifacts },
        status: "ready",
        openedAt: null,
      },
      select: {
        id: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { derivedFrom: true },
        },
      },
    });
    if (!rows.length) return false;
    const sourceIds = [
      ...new Set(rows.flatMap((row) => row.versions[0]?.derivedFrom ?? [])),
    ];
    const live = sourceIds.length
      ? new Set(
          (
            await tx.source.findMany({
              where: { id: { in: sourceIds }, deletedAt: null },
              select: { id: true },
            })
          ).map((s) => s.id),
        )
      : new Set<string>();
    return rows.some((row) =>
      (row.versions[0]?.derivedFrom ?? []).every((id) => live.has(id)),
    );
  };

  const hasOpenIntervention = async (): Promise<boolean> => {
    if (!items.interventions.length) return false;
    const rows = await tx.intervention.findMany({
      where: { id: { in: items.interventions }, ...openIntervention },
      select: { kind: true, dedupeKey: true },
    });
    if (rows.some((r) => r.kind !== "run_approvals")) return true;
    const runIds = [
      ...new Set(
        rows
          .filter((r) => r.kind === "run_approvals")
          .map((r) => causeOf(r.dedupeKey).subject.id),
      ),
    ];
    if (!runIds.length) return false;
    return (
      (await tx.action.count({
        where: { runId: { in: runIds }, ...openApprovalAt(at) },
      })) > 0
    );
  };

  const [hasIntervention, openApprovals, unreadNotices, readyArtifact] =
    await Promise.all([
      hasOpenIntervention(),
      items.approvals.length
        ? tx.action.count({
            where: { id: { in: items.approvals }, ...openApprovalAt(at) },
          })
        : 0,
      items.notices?.length
        ? tx.notice.count({
            where: { id: { in: items.notices }, readAt: null },
          })
        : 0,
      hasOpenArtifact(),
    ]);
  if (
    !hasIntervention &&
    openApprovals === 0 &&
    unreadNotices === 0 &&
    !readyArtifact
  )
    return refuse("nothing_open");

  const briefingId = randomUUID();
  await tx.briefing.create({
    data: {
      id: briefingId,
      studentId: run.studentId,
      agentId: run.agent.id,
      runId,
      textContent: briefing.text.content,
      textKey: briefing.text.contentKey,
      derivedFrom: briefing.text.derivedFrom,
      derivedFromConnections: briefing.text.derivedFromConnections,
      createdAt: at,
      items,
    },
  });
  await tx.delivery.createMany({
    data: channels.map((channel) => ({
      id: randomUUID(),
      studentId: run.studentId,
      channel,
      briefingId,
      dueAt: at,
    })),
  });
  return { status: "written", briefingId };
}
