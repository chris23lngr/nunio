import { describe, expect, it } from "vitest";
import { argumentsHash, definitions, InvalidIntentError } from "./kinds.js";

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
  "studyBlock.remove": {
    studyBlockId: "block-1",
    workId: "obligation-1",
    start: new Date("2026-11-10T09:00:00Z"),
    end: new Date("2026-11-10T10:00:00Z"),
  },
  "integration.call": {
    integrationKey: "testnotizen",
    connectionId: "connection-1",
    toolName: "notes.create_page",
    pinHash: "pin-1",
    arguments: { title: "Lineare Algebra", body: "Zusammenfassung" },
  },
} as const;
/** Fields the fingerprint leaves out: the Connection names its Integration, and the tool's current pin counts. */
const unfingerprinted: Record<string, string[]> = {
  "integration.call": ["integrationKey", "pinHash"],
};
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
    createdBy: null,
    locked: false,
    start: new Date("2026-11-10T09:00:00Z"),
    end: new Date("2026-11-10T10:00:00Z"),
  },
  "studyBlock.remove": {
    courseId: "course-1",
    obligationId: "obligation-1",
    placedBy: "nunio",
    createdBy: null,
    locked: false,
    start: new Date("2026-11-10T09:00:00Z"),
    end: new Date("2026-11-10T10:00:00Z"),
  },
  "integration.call": {
    connection: { state: "connected" },
    tool: { class: "write", definitionHash: "pin-1", chatOnly: false },
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

    it.each(
      Object.keys(samples[kind]).filter(
        (field) => !unfingerprinted[kind]?.includes(field),
      ),
    )("changes the fingerprint when %s changes", (field) => {
      const value = (samples[kind] as Record<string, unknown>)[field];
      const changed = {
        ...samples[kind],
        [field]:
          value instanceof Date ? later(value) : `${String(value)}-other`,
      };
      expect(
        definition.fingerprint(changed as never, subjects[kind] as never),
      ).not.toBe(
        definition.fingerprint(samples[kind] as never, subjects[kind] as never),
      );
    });
  },
);

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

describe("the integration.call fingerprint", () => {
  const { fingerprint } = definitions["integration.call"];
  const call = samples["integration.call"];
  const subject = subjects["integration.call"];

  it("hashes the tool arguments as canonical JSON, whatever their key order", () => {
    const reordered = {
      ...call,
      arguments: { body: "Zusammenfassung", title: "Lineare Algebra" },
    };
    expect(fingerprint(reordered, subject)).toBe(fingerprint(call, subject));
    expect(argumentsHash(reordered.arguments)).toBe(
      argumentsHash(call.arguments),
    );
  });

  it("changes when a nested argument changes", () => {
    const nested = { ...call, arguments: { page: { tags: ["a", "b"] } } };
    const other = { ...call, arguments: { page: { tags: ["b", "a"] } } };
    expect(fingerprint(nested, subject)).not.toBe(fingerprint(other, subject));
    expect(argumentsHash(nested.arguments)).not.toBe(
      argumentsHash(other.arguments),
    );
  });

  it("changes when the tool was re-reviewed under a new pin", () => {
    const repinned = {
      ...subject,
      tool: { ...subject.tool, definitionHash: "pin-2" },
    };
    expect(fingerprint(call, repinned)).not.toBe(fingerprint(call, subject));
  });

  it("stays the same when the tool is only reclassified", () => {
    const always = {
      ...subject,
      tool: { ...subject.tool, class: "write_always_asked" as const },
    };
    expect(fingerprint(call, always)).toBe(fingerprint(call, subject));
  });
});
