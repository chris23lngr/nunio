import type { Artifacts } from "@nunio/artifacts";
import type { PrismaClient } from "@nunio/db";
import type { Principal } from "@nunio/delegation";
import { openApprovalAt, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import { createDerivedText } from "@nunio/knowledge";
import { causeOf, noticeTextId, openIntervention } from "@nunio/outreach";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { Turn } from "./turn.js";
import { fenced } from "./turn.js";

/** What the student sees of a reading of the Inbox: counts of each open item type. */
export type InboxOutput = {
  interventions: number;
  approvals: number;
  notices: number;
  artifacts: number;
};

const artifactKinds: Record<string, string> = {
  practice_set: "Practice set",
  flashcards: "Flashcards",
  draft: "Draft",
  critique: "Critique",
};

/**
 * Reads the student's open Inbox items across all Courses for an Agent holding "Briefing erstellen" (#146):
 * open Interventions, every Agent's pending Approvals, unread Notices (without marking them read), and ready
 * Artifacts. Each item receives a handle (I1, A1, N1, R1) that `createBriefing` bundles it by. Every item is fenced
 * as data (ADR-0026), and any Source behind an unread Notice or ready Artifact is recorded on the turn so deleting
 * that Source shreds any Briefing that may have restated it (ADR-0007).
 */
export function inboxTool(
  turn: Turn,
  {
    db,
    keys,
    facts,
    artifacts,
    p,
    timeZone,
    clock,
  }: {
    db: PrismaClient;
    keys: SourceKeys;
    facts: Pick<Facts, "review">;
    artifacts: Pick<Artifacts, "list">;
    p: Principal;
    timeZone: string;
    clock: { now(): Date };
  },
): Tool<Record<string, never>, InboxOutput> {
  const derived = createDerivedText(keys);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const at = (instant: Date) => local.format(instant).replace(",", "");
  const span = (start: Date, end: Date) => `${at(start)}–${at(end).slice(11)}`;

  return tool({
    description:
      "Reads the student's open Inbox across all Courses: open Interventions (I1, ...), every Agent's pending Approvals (A1, ...), unread Notices (N1, ..., stays unread), and ready Artifacts (R1, ...). Use these handles when calling createBriefing.",
    inputSchema: jsonSchema<Record<string, never>>({
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
    execute: async (_, { toolCallId }): Promise<InboxOutput> => {
      const now = clock.now();
      const [readyArtifacts, review] = await Promise.all([
        artifacts.list(p, { ready: true }),
        facts.review(p),
      ]);
      const read = await withOwner(db, p, async (tx) => {
        const [interventions, approvals, noticeRows, artifactVersions] =
          await Promise.all([
            tx.intervention.findMany({
              where: openIntervention,
              orderBy: { createdAt: "desc" },
            }),
            tx.approval.findMany({
              where: { action: openApprovalAt(now) },
              include: {
                action: {
                  include: {
                    run: {
                      select: {
                        id: true,
                        agent: { select: { name: true } },
                      },
                    },
                  },
                },
              },
              orderBy: [
                { action: { createdAt: "asc" } },
                { action: { key: "asc" } },
              ],
            }),
            tx.notice.findMany({
              where: { readAt: null },
              orderBy: { createdAt: "desc" },
              include: { agent: { select: { name: true } } },
            }),
            readyArtifacts.length
              ? tx.artifact.findMany({
                  where: { id: { in: readyArtifacts.map((a) => a.id) } },
                  select: {
                    id: true,
                    versions: {
                      orderBy: { version: "desc" },
                      take: 1,
                      select: { derivedFrom: true },
                    },
                  },
                })
              : [],
          ]);
        const notices = await Promise.all(
          noticeRows.map(async (row) => ({
            id: row.id,
            agentName: row.agent.name,
            createdAt: row.createdAt,
            derivedFrom: row.derivedFrom,
            text: await derived.open(tx, noticeTextId(row.runId), {
              content: row.textContent,
              contentKey: row.textKey,
              derivedFrom: row.derivedFrom,
            }),
          })),
        );
        const actionIds = interventions
          .map((i) => causeOf(i.dedupeKey))
          .flatMap((c) => (c.subject.kind === "action" ? [c.subject.id] : []));
        const interventionActions = actionIds.length
          ? await tx.action.findMany({
              where: { id: { in: actionIds } },
              select: { id: true, kind: true, args: true },
            })
          : [];
        const workIds = [
          ...interventions
            .map((i) => causeOf(i.dedupeKey))
            .flatMap((c) => (c.subject.kind === "work" ? [c.subject.id] : [])),
          ...[
            ...approvals.map((a) => a.action),
            ...interventionActions,
          ].flatMap((a) => {
            const { workId } = a.args as { workId?: string };
            return workId ? [workId] : [];
          }),
        ];
        const tasks = workIds.length
          ? await tx.task.findMany({
              where: { id: { in: workIds } },
              select: { id: true, title: true, courseId: true },
            })
          : [];
        return {
          interventions,
          approvals,
          notices,
          artifactVersions,
          interventionActions,
          tasks,
        };
      });

      const courseTitle = new Map(
        review.courses.map((c) => [c.id, c.title] as const),
      );
      const obligationInfo = new Map(
        review.courses.flatMap((c) =>
          c.obligations.map(
            (o) => [o.id, { title: o.title, course: c.title }] as const,
          ),
        ),
      );
      const factInfo = new Map(
        review.courses.flatMap((c) =>
          c.facts.map(
            (f) => [f.id, { title: f.value, course: c.title }] as const,
          ),
        ),
      );
      const taskInfo = new Map(
        read.tasks.map(
          (t) =>
            [
              t.id,
              {
                title: t.title,
                course: t.courseId
                  ? (courseTitle.get(t.courseId) ?? null)
                  : null,
              },
            ] as const,
        ),
      );

      const describeWork = (id?: string) => {
        if (!id) return "unknown work";
        const info = obligationInfo.get(id) ?? taskInfo.get(id);
        return info
          ? info.course
            ? `"${info.title}" (${info.course})`
            : `"${info.title}"`
          : "unknown work";
      };

      const describeAction = (action: { kind: string; args: unknown }) => {
        const args = action.args as {
          workId?: string;
          start?: string;
          end?: string;
          title?: string;
          obligationId?: string;
        };
        const times =
          args.start && args.end
            ? span(new Date(args.start), new Date(args.end))
            : "";
        if (action.kind === "studyBlock.create")
          return `create Study Block for ${describeWork(args.workId)} at ${times}`;
        if (action.kind === "studyBlock.move")
          return `move Study Block to ${times}`;
        if (action.kind === "studyBlock.remove")
          return `remove Study Block (${times})`;
        if (action.kind === "task.create")
          return `create Task "${args.title ?? ""}"${args.obligationId ? ` toward ${describeWork(args.obligationId)}` : ""}`;
        return action.kind;
      };

      // Open Approvals grouped by Run, so run_approvals Interventions that lapsed lazily are skipped.
      const openByRun = new Map<string, { agentName: string; count: number }>();
      for (const { action } of read.approvals) {
        if (!action.run?.id) continue;
        const entry = openByRun.get(action.run.id);
        if (entry) entry.count += 1;
        else
          openByRun.set(action.run.id, {
            agentName: action.run.agent?.name ?? "Agent",
            count: 1,
          });
      }

      const interventionLines: string[] = [];
      for (const row of read.interventions) {
        const cause = causeOf(row.dedupeKey);
        if (cause.kind === "run_approvals") {
          const liveRun = openByRun.get(cause.subject.id);
          if (!liveRun) continue;
          const handle = turn.handleFor("intervention", row.id);
          interventionLines.push(
            `- ${handle} · run_approvals · ${liveRun.agentName} has ${liveRun.count} pending approval(s) · raised ${at(row.createdAt)}`,
          );
          continue;
        }
        const handle = turn.handleFor("intervention", row.id);
        let detail = "";
        if (cause.kind === "shortfall")
          detail = `shortfall on ${describeWork(cause.subject.id)}`;
        else if (cause.kind === "disagreement") {
          const info =
            cause.subject.kind === "obligation"
              ? obligationInfo.get(cause.subject.id)
              : factInfo.get(cause.subject.id);
          detail = info
            ? `disagreement on "${info.title}" (${info.course})`
            : "disagreement";
        } else {
          const action = read.interventionActions.find(
            (a) => a.id === cause.subject.id,
          );
          detail = `${cause.kind}: ${action ? describeAction(action) : "action"}`;
        }
        interventionLines.push(
          `- ${handle} · ${detail} · raised ${at(row.createdAt)}`,
        );
      }

      const approvalLines = read.approvals.map(({ expiresAt, action }) => {
        const handle = turn.handleFor("approval", action.id);
        const owner = action.run?.agent?.name ?? "Chat";
        return `- ${handle} · ${owner} · ${describeAction(action)} · expires ${at(expiresAt)}`;
      });

      const noticeLines = read.notices.map((n) => {
        if (n.text !== null)
          for (const sourceId of n.derivedFrom) turn.sources.add(sourceId);
        const handle = turn.handleFor("notice", n.id);
        return `- ${handle} · from ${n.agentName} · sent ${at(n.createdAt)} · ${n.text ?? "(text unavailable)"}`;
      });

      const versionSources = new Map(
        read.artifactVersions.map(
          (row) => [row.id, row.versions[0]?.derivedFrom ?? []] as const,
        ),
      );
      const artifactLines = readyArtifacts.map((a) => {
        for (const sourceId of versionSources.get(a.id) ?? [])
          turn.sources.add(sourceId);
        const handle = turn.handleFor("artifact", a.id);
        const kindLabel = artifactKinds[a.kind] ?? a.kind;
        const course = a.courseId ? courseTitle.get(a.courseId) : null;
        const count = a.count !== null ? ` · ${a.count} items` : "";
        return `- ${handle} · ${kindLabel} · "${a.title ?? kindLabel}"${course ? ` (${course})` : ""}${count} · ready since ${at(a.createdAt)}`;
      });

      turn.give(
        toolCallId,
        fenced("inbox", [
          "Open Interventions:",
          ...(interventionLines.length ? interventionLines : ["none"]),
          "Pending Approvals (every Agent):",
          ...(approvalLines.length ? approvalLines : ["none"]),
          "Unread Notices (still unread until the student opens them):",
          ...(noticeLines.length ? noticeLines : ["none"]),
          "Ready Artifacts:",
          ...(artifactLines.length ? artifactLines : ["none"]),
        ]),
      );
      return {
        interventions: interventionLines.length,
        approvals: approvalLines.length,
        notices: noticeLines.length,
        artifacts: artifactLines.length,
      };
    },
    toModelOutput: turn.modelOutput,
  });
}
