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
  clock,
}: {
  db: PrismaClient;
  facts: Facts;
  clock: { now(): Date };
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

  /** The Course's Topics in document order, where each sits, and all its Areas in their order. */
  async function stateOf(p: Principal, courseId: string) {
    const topics = await topicsOf(p, courseId);
    const [rows, stored] = await withOwner(db, p, (tx) =>
      Promise.all([
        tx.fact.findMany({
          where: { courseId, type: "topic" },
          select: {
            id: true,
            topicAreaId: true,
            topicAreaOrder: true,
            movedAt: true,
          },
        }),
        tx.topicArea.findMany({
          where: { courseId },
          orderBy: { order: "asc" },
        }),
      ]),
    );
    return { topics, row: new Map(rows.map((r) => [r.id, r])), stored };
  }

  return {
    /** Runs the grouping pass for one Course: one metered call, then stores the Areas it returns. */
    async group(
      p: Principal,
      courseId: string,
      deps: { grouper: Grouper; delegation: Delegation; signal?: AbortSignal },
    ) {
      const { topics, row, stored } = await stateOf(p, courseId);
      if (topics.length < minTopics) return { status: "skipped" } as const;
      const handles = new Map(topics.map((topic, i) => [`t${i + 1}`, topic]));
      const areaName = new Map(
        stored.filter((a) => !a.rejectedAt).map((a) => [a.id, a.name]),
      );
      const input: GroupingInput = {
        topics: [...handles].map(([handle, topic]) => ({
          handle,
          name: topic.name,
          source: topic.source,
          page: topic.page,
          quote: topic.quote,
          area: areaName.get(row.get(topic.id)?.topicAreaId ?? "") ?? null,
        })),
        areas: stored.map((area) => ({
          name: area.name,
          rejected: Boolean(area.rejectedAt),
        })),
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
      // Groups are sticky: only Topics without an Area that the student did not place count, each in its first Area.
      const placeable = (handle: string) => {
        const topic = handles.get(handle);
        const placed = topic && row.get(topic.id);
        return Boolean(placed && !placed.topicAreaId && !placed.movedAt);
      };
      const taken = new Set<string>();
      const byKey = new Map(stored.map((area) => [area.matchKey, area]));
      let nextOrder = Math.max(-1, ...stored.map((area) => area.order)) + 1;
      await withOwner(db, p, async (tx, studentId) => {
        for (const area of result.value.areas) {
          const members = area.topics.filter((handle) => {
            if (!placeable(handle) || taken.has(handle)) return false;
            taken.add(handle);
            return true;
          });
          const existing = byKey.get(normalize(area.name));
          if (existing?.rejectedAt) continue;
          // A new Area needs two Topics; an existing one may take a single new Topic.
          if (members.length < (existing ? 1 : 2)) continue;
          let id = existing?.id;
          if (!id) {
            id = randomUUID();
            await tx.topicArea.create({
              data: {
                id,
                studentId,
                courseId,
                matchKey: normalize(area.name),
                name: area.name,
                order: nextOrder++,
                inferred: true,
              },
            });
          }
          const start =
            Math.max(
              -1,
              ...[...row.values()]
                .filter((r) => r.topicAreaId === id)
                .map((r) => r.topicAreaOrder ?? 0),
            ) + 1;
          for (const [position, handle] of members.entries()) {
            await tx.fact.update({
              where: { id: handles.get(handle)!.id },
              data: { topicAreaId: id, topicAreaOrder: start + position },
            });
          }
        }
      });
      return { status: "grouped" } as const;
    },

    /** The student names an Area; later passes reuse it by that name. Another Area of the Course with it clashes. */
    async rename(p: Principal, areaId: string, name: string) {
      const trimmed = name.trim();
      return withOwner(db, p, async (tx) => {
        const area = await tx.topicArea.findFirst({
          where: { id: areaId, rejectedAt: null },
        });
        if (!area) return { status: "not_found" } as const;
        const matchKey = normalize(trimmed);
        const clash = await tx.topicArea.findFirst({
          where: { courseId: area.courseId, matchKey, id: { not: areaId } },
        });
        if (clash) return { status: "clash" } as const;
        await tx.topicArea.update({
          where: { id: areaId },
          data: { name: trimmed, matchKey, renamedAt: clock.now() },
        });
        return { status: "ok" } as const;
      });
    },

    /** The student rejects an Area: it is never recreated, and its Topics stay ungrouped as if moved out. */
    async reject(p: Principal, areaId: string) {
      return withOwner(db, p, async (tx) => {
        const area = await tx.topicArea.findFirst({
          where: { id: areaId, rejectedAt: null },
        });
        if (!area) return { status: "not_found" } as const;
        await tx.fact.updateMany({
          where: { topicAreaId: areaId },
          data: {
            topicAreaId: null,
            topicAreaOrder: null,
            movedAt: clock.now(),
          },
        });
        await tx.topicArea.update({
          where: { id: areaId },
          data: { rejectedAt: clock.now() },
        });
        return { status: "ok" } as const;
      });
    },

    /** The student puts a Topic last in another Area of its Course, or in none; later passes leave it there. */
    async move(p: Principal, topicId: string, areaId: string | null) {
      return withOwner(db, p, async (tx) => {
        const topic = await tx.fact.findFirst({
          where: { id: topicId, type: "topic" },
        });
        if (!topic) return { status: "not_found" } as const;
        const area = areaId
          ? await tx.topicArea.findFirst({
              where: { id: areaId, courseId: topic.courseId, rejectedAt: null },
            })
          : null;
        if (areaId && !area) return { status: "not_found" } as const;
        const last = area
          ? await tx.fact.aggregate({
              where: { topicAreaId: area.id },
              _max: { topicAreaOrder: true },
            })
          : null;
        await tx.fact.update({
          where: { id: topicId },
          data: {
            topicAreaId: area?.id ?? null,
            topicAreaOrder: last ? (last._max.topicAreaOrder ?? -1) + 1 : null,
            movedAt: clock.now(),
          },
        });
        return { status: "ok" } as const;
      });
    },

    /** The Course's Topic Areas with their Topics, then the Topics in none, each in their order. */
    async list(p: Principal, courseId: string) {
      const { topics, row, stored } = await stateOf(p, courseId);
      const view = (topic: (typeof topics)[number]) => ({
        id: topic.id,
        name: topic.name,
      });
      const listed = stored
        .filter((area) => !area.rejectedAt)
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
