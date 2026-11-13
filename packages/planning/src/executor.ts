import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Executor } from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";

/** What an Action took effect on: the block it placed or moved, or the Task it added or reopened. */
const effectOf = (done: {
  studyBlockId: string | null;
  taskId: string | null;
}) =>
  done.taskId ? { taskId: done.taskId } : { studyBlockId: done.studyBlockId! };

/** The gate's executor for Study Blocks and Tasks within nunio's Plan: each key takes its effect at most once. */
export function createPlanExecutor({ db }: { db: PrismaClient }): Executor {
  return {
    async execute({ studentId, intent }, { idempotencyKey }) {
      return withOwner(db, principal.fromSession({ studentId }), async (tx) => {
        // Serializes executions of one key, so a repeat sees the effect the first recorded.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
        const done = await tx.planEffect.findUnique({
          where: { studentId_idempotencyKey: { studentId, idempotencyKey } },
        });
        if (done) return { status: "done", effect: effectOf(done) };
        if (intent.kind === "task.create" || intent.kind === "task.reopen") {
          let taskId: string;
          if (intent.kind === "task.create") {
            const { fixedEventId, role } = intent;
            if (
              fixedEventId &&
              !(await tx.fixedEvent.findUnique({ where: { id: fixedEventId } }))
            )
              return { status: "rejected", detail: "the Course Event is gone" };
            // The event has this Task already, so the student's wish is met.
            const existing =
              fixedEventId && role
                ? await tx.task.findUnique({
                    where: { fixedEventId_role: { fixedEventId, role } },
                  })
                : null;
            if (existing) taskId = existing.id;
            else {
              taskId = randomUUID();
              await tx.task.create({
                data: {
                  id: taskId,
                  studentId,
                  title: intent.title,
                  courseId: intent.courseId,
                  fixedEventId: intent.fixedEventId,
                  role: intent.role,
                  estimateMinutes: intent.estimateMinutes,
                  estimatedBy: intent.estimateMinutes ? "student" : null,
                },
              });
            }
          } else {
            const { count } = await tx.task.updateMany({
              where: { id: intent.taskId },
              data: { doneAt: null },
            });
            if (!count)
              return { status: "rejected", detail: "the Task is gone" };
            taskId = intent.taskId;
          }
          await tx.planEffect.create({
            data: { idempotencyKey, studentId, taskId },
          });
          return { status: "done", effect: { taskId } };
        }
        let studyBlockId: string = randomUUID();
        if (intent.kind === "studyBlock.move") {
          const { count } = await tx.studyBlock.updateMany({
            where: { id: intent.studyBlockId },
            data: { start: intent.start, end: intent.end },
          });
          if (!count)
            return { status: "rejected", detail: "the block is gone" };
          studyBlockId = intent.studyBlockId;
        } else if (intent.kind === "studyBlock.remove") {
          const { count } = await tx.studyBlock.deleteMany({
            where: { id: intent.studyBlockId },
          });
          if (!count)
            return { status: "rejected", detail: "the block is gone" };
          studyBlockId = intent.studyBlockId;
        } else {
          const work = (await tx.obligation.findUnique({
            where: { id: intent.workId },
          }))
            ? { obligationId: intent.workId }
            : (await tx.task.findUnique({ where: { id: intent.workId } }))
              ? { taskId: intent.workId }
              : null;
          if (!work) return { status: "rejected", detail: "the work is gone" };
          await tx.studyBlock.create({
            data: {
              id: studyBlockId,
              studentId,
              ...work,
              start: intent.start,
              end: intent.end,
              placedBy: "nunio",
            },
          });
        }
        await tx.planEffect.create({
          data: { idempotencyKey, studentId, studyBlockId },
        });
        return { status: "done", effect: { studyBlockId } };
      });
    },
    /** Always certain: the effect and its record commit together. */
    async lookup(idempotencyKey, { studentId }) {
      const done = await withOwner(
        db,
        principal.fromSession({ studentId }),
        (tx) =>
          tx.planEffect.findUnique({
            where: { studentId_idempotencyKey: { studentId, idempotencyKey } },
          }),
      );
      return done
        ? { status: "found", effect: effectOf(done) }
        : { status: "absent" };
    },
  };
}
