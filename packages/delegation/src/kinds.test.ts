import { describe, expect, it } from "vitest";
import { definitions, InvalidIntentError } from "./kinds.js";

// The per-kind contract suite: every Action kind the gate can perform must pass it.
const samples = {
  "studyBlock.create": {
    workId: "obligation-1",
    start: new Date("2026-11-10T09:00:00Z"),
    end: new Date("2026-11-10T10:00:00Z"),
  },
  "studyBlock.move": {
    studyBlockId: "block-1",
    start: new Date("2026-11-11T09:00:00Z"),
    end: new Date("2026-11-11T10:00:00Z"),
  },
  "task.create": {
    title: "Nachbereitung: Analysis I",
    courseId: "course-1",
    fixedEventId: "event-1",
    role: "follow_up",
    estimateMinutes: 60,
  },
  "task.reopen": { taskId: "task-1" },
} as const;
const subjects = {
  "task.create": { courseId: "course-1", obligationId: null },
  "task.reopen": {
    courseId: "course-1",
    obligationId: null,
    title: "Nachbereitung: Analysis I",
  },
  "studyBlock.create": { courseId: "course-1", obligationId: "obligation-1" },
  "studyBlock.move": {
    courseId: "course-1",
    obligationId: "obligation-1",
    placedBy: "nunio",
    locked: false,
    start: new Date("2026-11-10T09:00:00Z"),
    end: new Date("2026-11-10T10:00:00Z"),
  },
} as const;
const later = (date: Date) => new Date(date.getTime() + 30 * 60_000);

describe.each(Object.keys(definitions) as (keyof typeof definitions)[])(
  "the %s contract",
  (kind) => {
    const definition = definitions[kind];
    // Kinds without a time span have no start or end, which only makes these arguments junk in another way.
    const timed = samples[kind] as { start?: Date; end?: Date };

    it.each([
      ["no arguments", undefined],
      ["a string", "junk"],
      ["a missing field", { start: timed.start }],
      [
        "an end before its start",
        { ...samples[kind], start: timed.end, end: timed.start },
      ],
      ["an unparseable date", { ...samples[kind], start: "tomorrow" }],
      ["an unknown field", { ...samples[kind], studentId: "someone-else" }],
    ])("rejects %s", (_, junk) => {
      expect(() => definition.parse(junk)).toThrow(InvalidIntentError);
    });

    it("gives the same Action the same fingerprint", () => {
      expect(
        definition.fingerprint(samples[kind] as never, subjects[kind] as never),
      ).toBe(
        definition.fingerprint(
          structuredClone(samples[kind]) as never,
          structuredClone(subjects[kind]) as never,
        ),
      );
    });

    it.each(Object.keys(samples[kind]))(
      "changes the fingerprint when %s changes",
      (field) => {
        const value = (samples[kind] as Record<string, unknown>)[field];
        const changed = {
          ...samples[kind],
          [field]:
            value instanceof Date ? later(value) : `${String(value)}-other`,
        };
        expect(
          definition.fingerprint(changed as never, subjects[kind] as never),
        ).not.toBe(
          definition.fingerprint(
            samples[kind] as never,
            subjects[kind] as never,
          ),
        );
      },
    );

    it("decides Grant coverage purely: the same answer every time, inputs untouched", () => {
      const scopes = [
        { courseId: "course-1" },
        { courseId: "course-2" },
        { obligationId: "obligation-1" },
      ];
      for (const scope of scopes) {
        const frozen = deepFreeze({
          scope,
          args: structuredClone(samples[kind]),
          subject: structuredClone(subjects[kind]),
        });
        const first = definition.grantCovers(
          frozen.scope,
          frozen.args as never,
          frozen.subject as never,
        );
        expect(
          definition.grantCovers(
            frozen.scope,
            frozen.args as never,
            frozen.subject as never,
          ),
        ).toBe(first);
      }
    });
  },
);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !(value instanceof Date))
    Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

describe("Grant coverage", () => {
  const create = definitions["studyBlock.create"],
    move = definitions["studyBlock.move"];

  it.each([
    ["its Course", { courseId: "course-1" }, true],
    ["another Course", { courseId: "course-2" }, false],
    ["its Obligation", { obligationId: "obligation-1" }, true],
    ["another Obligation", { obligationId: "obligation-2" }, false],
  ])("covers work only within the Grant's scope: %s", (_, scope, covered) => {
    expect(
      create.grantCovers(
        scope,
        samples["studyBlock.create"],
        subjects["studyBlock.create"],
      ),
    ).toBe(covered);
    expect(
      move.grantCovers(
        scope,
        samples["studyBlock.move"],
        subjects["studyBlock.move"],
      ),
    ).toBe(covered);
  });

  it.each(["task.create", "task.reopen"] as const)(
    "never covers %s: a Task is asked from a Chat only (ADR-0022)",
    (kind) => {
      expect(
        definitions[kind].grantCovers(
          { courseId: "course-1" },
          samples[kind] as never,
          subjects[kind] as never,
        ),
      ).toBe(false);
    },
  );

  it("never covers moving a block the student placed or moved: that needs their Approval", () => {
    const theirs = {
      ...subjects["studyBlock.move"],
      placedBy: "student" as const,
    };
    expect(
      move.grantCovers(
        { courseId: "course-1" },
        samples["studyBlock.move"],
        theirs,
      ),
    ).toBe(false);
  });
});

describe("the studyBlock.move fingerprint", () => {
  it("changes when the block moved since the student was shown the Action", () => {
    const moved = {
      ...subjects["studyBlock.move"],
      start: later(subjects["studyBlock.move"].start),
    };
    expect(
      definitions["studyBlock.move"].fingerprint(
        samples["studyBlock.move"],
        moved,
      ),
    ).not.toBe(
      definitions["studyBlock.move"].fingerprint(
        samples["studyBlock.move"],
        subjects["studyBlock.move"],
      ),
    );
  });
});
