import { randomUUID } from "node:crypto";
import type { Transaction } from "@nunio/delegation";
import { runCaps } from "@nunio/delegation";
import type { Sealed } from "@nunio/knowledge";
import { channels } from "./raise.js";

/** Why an Agent's Run sent no Notice. */
export type NoticeRefusal =
  | "run_ended"
  | "paused"
  | "ended"
  | "no_capability"
  | "run_cap";

/** What a Notice's text is sealed for, so it opens only as this Run's Notice. */
export const noticeTextId = (runId: string) => `${runId}:notice`;

/**
 * Sends the student the Notice an Agent's Run wrote (#155), its text sealed for `noticeTextId(runId)`: only while the
 * Run is under way and its Agent active and still holding "Dich benachrichtigen", and at most one per Run (ADR-0026).
 * It goes to the Inbox and is queued on each channel, to be announced like an Intervention: outside Quiet Hours, within
 * the daily limit, and only while still unread. Runs in the caller's transaction, serialised with ending the Run.
 */
export async function sendNotice(
  tx: Transaction,
  runId: string,
  text: Sealed,
  at: Date,
): Promise<
  | { status: "sent"; noticeId: string }
  | { status: "refused"; reason: NoticeRefusal }
> {
  const refuse = (reason: NoticeRefusal) =>
    ({ status: "refused", reason }) as const;
  await tx.$executeRaw`SELECT 1 FROM "run" WHERE "id" = ${runId} FOR UPDATE`;
  const run = await tx.run.findUniqueOrThrow({
    where: { id: runId },
    include: { agent: { include: { capabilities: true } }, notice: true },
  });
  if (run.status !== "running" || !run.agent) return refuse("run_ended");
  if (run.agent.state !== "active") return refuse(run.agent.state);
  if (!run.agent.capabilities.some((c) => c.capability === "notifyStudent"))
    return refuse("no_capability");
  if ((run.notice ? 1 : 0) >= runCaps.notices) return refuse("run_cap");
  const noticeId = randomUUID();
  await tx.notice.create({
    data: {
      id: noticeId,
      studentId: run.studentId,
      agentId: run.agent.id,
      runId,
      textContent: text.content,
      textKey: text.contentKey,
      derivedFrom: text.derivedFrom,
      createdAt: at,
    },
  });
  await tx.delivery.createMany({
    data: channels.map((channel) => ({
      id: randomUUID(),
      studentId: run.studentId,
      channel,
      noticeId,
      dueAt: at,
    })),
  });
  return { status: "sent", noticeId };
}
