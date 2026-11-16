import { randomUUID } from "node:crypto";
import type { Grouper, GroupingInput } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type { Delegation, Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { Facts } from "./facts.js";
import { normalize } from "./normalize.js";

export type TopicAreas = ReturnType<typeof createTopicAreas>;

/** Below this many Topics a Course shows its flat list, and the pass asks no model. */
const minTopics = 8;

/** Topic Areas (ADR-0023): named groups of a Course's Topics, inferred by a grouping pass. */
export function createTopicAreas({
  db,
  facts,
}: {
  db: PrismaClient;
  facts: Facts;
}) {
  /** The Course's Topics that are not rejected, in document order: by first Source, then page, then name. */
  async function topicsOf(p: Principal, courseId: string) {
    const course = (await facts.review(p)).courses.find(
      (c) => c.id === courseId,
    );
    const topics = (course?.facts ?? []).filter(
      (fact) => fact.type === "topic" && fact.state !== "rejected",
    );
    const citations = topics.map((topic) =>
      topic.values.flatMap((value) => value.citations),
    );
    const read = await withOwner(db, p, (tx) =>
      tx.source.findMany({
        where: { id: { in: citations.flat().map((c) => c.sourceId) } },
        select: { id: true, createdAt: true },
      }),
    );
    const readAt = new Map(read.map((s) => [s.id, s.createdAt.getTime()]));
    const placed = topics.map((topic, index) => {
      const first = citations[index]!.toSorted(
        (a, b) =>
          (readAt.get(a.sourceId) ?? 0) - (readAt.get(b.sourceId) ?? 0) ||
          a.page - b.page,
      )[0];
      return {
        id: topic.id,
        name: topic.value,
        source: first?.title ?? "",
        page: first?.page ?? 0,
        quote: first?.quote ?? "",
        at: first ? (readAt.get(first.sourceId) ?? 0) : Infinity,
      };
    });
    // A page is the finest position stored, so Topics on one page follow their name.
    return placed.toSorted(
      (a, b) =>
        a.at - b.at || a.page - b.page || a.name.localeCompare(b.name, "de"),
    );
  }

  return {
    /** Runs the grouping pass for one Course: one metered call, then stores the Areas it returns. */
    async group(
      p: Principal,
      courseId: string,
      deps: { grouper: Grouper; delegation: Delegation; signal?: AbortSignal },
    ) {
      const topics = await topicsOf(p, courseId);
      if (topics.length < minTopics) return { status: "skipped" } as const;
      const handles = new Map(topics.map((topic, i) => [`t${i + 1}`, topic]));
      const input: GroupingInput = {
        topics: [...handles].map(([handle, topic]) => ({
          handle,
          name: topic.name,
          source: topic.source,
          page: topic.page,
          quote: topic.quote,
          area: null,
        })),
        areas: [],
      };
      const result = await deps.delegation.meter(
        p,
        { microUsd: deps.grouper.estimateMicroUsd(input) },
        (signal) =>
          deps.grouper.group(input, {
            signal: deps.signal
              ? AbortSignal.any([signal, deps.signal])
              : signal,
          }),
      );
      if (result.status === "refused")
        return { status: "refused", reason: result.reason } as const;
      // Only Topics the model was shown count, each in its first Area; an Area needs two of them.
      const taken = new Set<string>();
      const answered = result.value.areas
        .map((area) => ({
          name: area.name,
          topics: area.topics.filter((handle) => {
            if (!handles.has(handle) || taken.has(handle)) return false;
            taken.add(handle);
            return true;
          }),
        }))
        .filter((area) => area.topics.length >= 2);
      await withOwner(db, p, async (tx, studentId) => {
        for (const [order, area] of answered.entries()) {
          const id = randomUUID();
          await tx.topicArea.create({
            data: {
              id,
              studentId,
              courseId,
              matchKey: normalize(area.name),
              name: area.name,
              order,
              inferred: true,
            },
          });
          for (const [position, handle] of area.topics.entries()) {
            await tx.fact.update({
              where: { id: handles.get(handle)!.id },
              data: { topicAreaId: id, topicAreaOrder: position },
            });
          }
        }
      });
      return { status: "grouped" } as const;
    },

    /** The Course's Topic Areas with their Topics, then the Topics in none, each in their order. */
    async list(p: Principal, courseId: string) {
      const topics = await topicsOf(p, courseId);
      const [rows, stored] = await withOwner(db, p, (tx) =>
        Promise.all([
          tx.fact.findMany({
            where: { courseId, type: "topic" },
            select: { id: true, topicAreaId: true, topicAreaOrder: true },
          }),
          tx.topicArea.findMany({
            where: { courseId, rejectedAt: null },
            orderBy: { order: "asc" },
          }),
        ]),
      );
      const row = new Map(rows.map((r) => [r.id, r]));
      const view = (topic: (typeof topics)[number]) => ({
        id: topic.id,
        name: topic.name,
      });
      const listed = stored
        .map((area) => ({
          id: area.id,
          name: area.name,
          inferred: area.inferred,
          topics: topics
            .filter((topic) => row.get(topic.id)?.topicAreaId === area.id)
            .toSorted(
              (a, b) =>
                (row.get(a.id)?.topicAreaOrder ?? 0) -
                (row.get(b.id)?.topicAreaOrder ?? 0),
            )
            .map(view),
        }))
        .filter((area) => area.topics.length);
      const shownIds = new Set(listed.map((area) => area.id));
      return {
        areas: listed,
        ungrouped: topics
          .filter((topic) => {
            const areaId = row.get(topic.id)?.topicAreaId;
            return !areaId || !shownIds.has(areaId);
          })
          .map(view),
      };
    },
  };
}
