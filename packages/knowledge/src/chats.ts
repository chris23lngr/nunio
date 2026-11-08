import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { withOwner, type Principal } from "@nunio/delegation";
import type { CitationRef } from "./reader.js";

type Citation = { tag: string; cite: CitationRef };

/** Chats and their explicit selection of Courses and Sources. */
export function createChats({ db }: { db: PrismaClient }) {
  return {
    async create(p: Principal, selection: { courseIds: string[]; sourceIds: string[] }) {
      return withOwner(db, p, async (tx, studentId) => {
        // RLS hides another student's rows, so a foreign ID counts as gone like a deleted one.
        const courses = await tx.course.count({ where: { id: { in: selection.courseIds }, status: { not: "merged" } } });
        const sources = await tx.source.count({ where: { id: { in: selection.sourceIds }, deletedAt: null } });
        if (courses !== new Set(selection.courseIds).size || sources !== new Set(selection.sourceIds).size) return { status: "gone" } as const;
        const chat = await tx.chat.create({ data: { id: randomUUID(), studentId } });
        await tx.chatCourse.createMany({ data: [...new Set(selection.courseIds)].map(courseId => ({ chatId: chat.id, courseId, studentId })) });
        await tx.chatSource.createMany({ data: [...new Set(selection.sourceIds)].map(sourceId => ({ chatId: chat.id, sourceId, studentId })) });
        return { status: "ok", id: chat.id } as const;
      });
    },
    /** The Chat's messages, oldest first; null when the Chat is gone. */
    async messages(p: Principal, chatId: string) {
      return withOwner(db, p, async tx => {
        const chat = await tx.chat.findUnique({ where: { id: chatId },
          include: { messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, text: true, citations: true } } } });
        return chat?.messages.map(({ id, role, text, citations }) =>
          ({ id, role: role as "student" | "assistant", text, citations: citations as Citation[] })) ?? null;
      });
    },
    /** Records a question and its answer; null when the Chat is gone. */
    async record(p: Principal, chatId: string, exchange: { question: string; answer: string; citations: Citation[] }) {
      return withOwner(db, p, async (tx, studentId) => {
        if (!await tx.chat.findUnique({ where: { id: chatId } })) return null;
        const at = Date.now();
        await tx.chatMessage.create({ data: { id: randomUUID(), chatId, studentId, role: "student", text: exchange.question, createdAt: new Date(at) } });
        const answer = await tx.chatMessage.create({ data: { id: randomUUID(), chatId, studentId, role: "assistant", text: exchange.answer,
          citations: exchange.citations, createdAt: new Date(at + 1) } });
        return { id: answer.id };
      });
    },
  };
}
export type Chats = ReturnType<typeof createChats>;
