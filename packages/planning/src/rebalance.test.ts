import { describe, expect, it } from "vitest";
import type { PlanState } from "./rebalance.js";
import { rebalance } from "./rebalance.js";

/** A Berlin wall-clock time in November (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
const span = (from: string, to: string) => ({ start: at(from), end: at(to) });

/** Monday 9 November 2026, 08:00 in Berlin; study 09:00–18:00, at most 4 hours a day. */
const base: PlanState = {
  now: at("2026-11-09 08:00"),
  timeZone: "Europe/Berlin",
  obligations: [],
  tasks: [],
  studyBlocks: [],
  fixedEvents: [],
  protectedTime: [],
  preferences: {
    studyWindow: { fromMinute: 9 * 60, toMinute: 18 * 60 },
    maxMinutesPerDay: 240,
  },
};
const sheet = {
  id: "sheet-3",
  due: at("2026-11-11 12:00"),
  estimateMinutes: 120,
  priority: 1,
};
const creates = (state: PlanState) =>
  rebalance(state).moves.flatMap((move) =>
    move.kind === "create"
      ? [
          {
            workId: move.workId,
            start: move.start,
            end: move.end,
            needsApproval: move.needsApproval,
          },
        ]
      : [],
  );

describe("rebalance", () => {
  it("places an Obligation's Estimate in the earliest free study time before its deadline", () => {
    expect(creates({ ...base, obligations: [sheet] })).toEqual([
      {
        workId: "sheet-3",
        ...span("2026-11-09 09:00", "2026-11-09 11:00"),
        needsApproval: false,
      },
    ]);
  });

  it.each([
    {
      name: "a lecture (Fixed Event)",
      state: { fixedEvents: [span("2026-11-09 10:00", "2026-11-09 12:00")] },
      expected: [
        span("2026-11-09 09:00", "2026-11-09 10:00"),
        span("2026-11-09 12:00", "2026-11-09 13:00"),
      ],
    },
    {
      name: "Protected Time",
      state: { protectedTime: [span("2026-11-09 09:00", "2026-11-09 17:00")] },
      expected: [
        span("2026-11-09 17:00", "2026-11-09 18:00"),
        span("2026-11-10 09:00", "2026-11-10 10:00"),
      ],
    },
    {
      name: "an existing Study Block",
      state: {
        studyBlocks: [
          {
            id: "b1",
            workId: "other",
            placedBy: "student" as const,
            locked: false,
            ...span("2026-11-09 09:00", "2026-11-09 10:30"),
          },
        ],
      },
      expected: [span("2026-11-09 10:30", "2026-11-09 12:30")],
    },
  ])("never schedules over $name", ({ state, expected }) => {
    expect(
      creates({ ...base, ...state, obligations: [sheet] }).map(
        ({ start, end }) => ({ start, end }),
      ),
    ).toEqual(expected);
  });

  it("counts time already planned for the work towards its Estimate", () => {
    const planned = {
      id: "b1",
      workId: "sheet-3",
      placedBy: "nunio" as const,
      locked: false,
      ...span("2026-11-10 09:00", "2026-11-10 10:30"),
    };
    expect(
      creates({ ...base, obligations: [sheet], studyBlocks: [planned] }),
    ).toEqual([
      {
        workId: "sheet-3",
        ...span("2026-11-09 09:00", "2026-11-09 09:30"),
        needsApproval: false,
      },
    ]);
  });

  it("reports a Shortfall with tradeoffs instead of overfilling, never offering Protected Time", () => {
    const exam = {
      id: "exam",
      due: at("2026-11-10 12:00"),
      estimateMinutes: 600,
      priority: 1,
    };
    const evening = span("2026-11-09 16:00", "2026-11-09 18:00");
    const proposal = rebalance({
      ...base,
      obligations: [exam],
      protectedTime: [evening],
    });

    const planned = creates({
      ...base,
      obligations: [exam],
      protectedTime: [evening],
    }).reduce(
      (sum, move) => sum + (move.end.getTime() - move.start.getTime()) / 60_000,
      0,
    );
    expect(planned).toBe(240 + 180);
    expect(proposal.shortfalls).toEqual([
      {
        workId: "exam",
        due: exam.due,
        shortMinutes: 180,
        tradeoffs: [
          // Monday's window has 7 h outside Protected Time; 4 h are already within the limit.
          {
            kind: "exceed_daily_limit",
            gainedMinutes: 180,
            needsApproval: true,
          },
          { kind: "reduce_estimate", workId: "exam", byMinutes: 180 },
        ],
      },
    ]);
  });

  describe("a Study Block the calendar now overlaps", () => {
    const lecture = span("2026-11-09 09:00", "2026-11-09 10:00");
    const block = (placedBy: "nunio" | "student", locked: boolean) => ({
      id: "b1",
      workId: "sheet-3",
      placedBy,
      locked,
      ...span("2026-11-09 09:00", "2026-11-09 10:00"),
    });
    it.each([
      {
        name: "nunio placed is moved without Approval",
        placedBy: "nunio" as const,
        locked: false,
        moves: [
          {
            kind: "move",
            blockId: "b1",
            workId: "sheet-3",
            from: lecture,
            to: span("2026-11-09 10:00", "2026-11-09 11:00"),
            needsApproval: false,
          },
        ],
        overlaps: [],
      },
      {
        name: "the student placed is moved only with Approval",
        placedBy: "student" as const,
        locked: false,
        moves: [
          {
            kind: "move",
            blockId: "b1",
            workId: "sheet-3",
            from: lecture,
            to: span("2026-11-09 10:00", "2026-11-09 11:00"),
            needsApproval: true,
          },
        ],
        overlaps: [],
      },
      {
        name: "Locked is never moved, only reported",
        placedBy: "student" as const,
        locked: true,
        moves: [],
        overlaps: [{ blockId: "b1", reason: "locked" }],
      },
    ])("$name", ({ placedBy, locked, moves, overlaps }) => {
      const proposal = rebalance({
        ...base,
        obligations: [{ ...sheet, estimateMinutes: 60 }],
        fixedEvents: [lecture],
        studyBlocks: [block(placedBy, locked)],
      });
      expect(proposal.moves).toEqual(moves);
      expect(proposal.overlaps).toEqual(overlaps);
    });
  });

  it("places the earliest deadline first, and on equal deadlines the higher Priority first", () => {
    const essay = {
      id: "essay",
      due: at("2026-11-20 12:00"),
      estimateMinutes: 60,
      priority: 1,
    };
    const quiz = {
      id: "quiz",
      due: at("2026-11-10 12:00"),
      estimateMinutes: 60,
      priority: 3,
    };
    const lab = {
      id: "lab",
      due: at("2026-11-10 12:00"),
      estimateMinutes: 60,
      priority: 2,
    };
    expect(
      creates({ ...base, obligations: [essay, quiz, lab] }).map((move) => [
        move.workId,
        move.start,
      ]),
    ).toEqual([
      ["lab", at("2026-11-09 09:00")],
      ["quiz", at("2026-11-09 10:00")],
      ["essay", at("2026-11-09 11:00")],
    ]);
  });

  it("reports every Obligation it cannot plan, never dropping one silently", () => {
    const proposal = rebalance({
      ...base,
      obligations: [
        {
          id: "unestimated",
          due: at("2026-11-12 12:00"),
          estimateMinutes: null,
          priority: 1,
        },
        { id: "undated", due: null, estimateMinutes: 60, priority: 1 },
        {
          id: "overdue",
          due: at("2026-11-08 12:00"),
          estimateMinutes: 60,
          priority: 1,
        },
      ],
    });
    expect(proposal.moves).toEqual([]);
    expect(proposal.unplanned).toEqual([
      { workId: "unestimated", reason: "no_estimate" },
      { workId: "undated", reason: "no_deadline" },
      { workId: "overdue", reason: "past_due" },
    ]);
  });

  it("plans an Obligation through its open Tasks, skipping completed ones", () => {
    const proposal = rebalance({
      ...base,
      obligations: [sheet],
      tasks: [
        {
          id: "q1-4",
          obligationId: "sheet-3",
          estimateMinutes: 60,
          done: true,
        },
        {
          id: "q5-8",
          obligationId: "sheet-3",
          estimateMinutes: 90,
          done: false,
        },
        { id: "read", obligationId: null, estimateMinutes: 30, done: false },
      ],
    });
    expect(proposal.moves).toEqual([
      {
        kind: "create",
        workId: "q5-8",
        ...span("2026-11-09 09:00", "2026-11-09 10:30"),
        needsApproval: false,
      },
    ]);
    expect(proposal.unplanned).toEqual([
      { workId: "read", reason: "no_deadline" },
    ]);
  });

  it("offers time planned for lower-Priority work before the deadline as a tradeoff, never higher-Priority work", () => {
    const exam = {
      id: "exam",
      due: at("2026-11-10 12:00"),
      estimateMinutes: 480,
      priority: 2,
    };
    const essay = {
      id: "essay",
      due: at("2026-11-20 12:00"),
      estimateMinutes: 60,
      priority: 3,
    };
    const thesis = {
      id: "thesis",
      due: at("2026-11-30 12:00"),
      estimateMinutes: 60,
      priority: 1,
    };
    const essayBlock = {
      id: "b-essay",
      workId: "essay",
      placedBy: "student" as const,
      locked: false,
      ...span("2026-11-09 09:00", "2026-11-09 10:00"),
    };
    const thesisBlock = {
      id: "b-thesis",
      workId: "thesis",
      placedBy: "nunio" as const,
      locked: false,
      ...span("2026-11-09 10:00", "2026-11-09 11:00"),
    };

    const [shortfall] = rebalance({
      ...base,
      obligations: [exam, essay, thesis],
      studyBlocks: [essayBlock, thesisBlock],
    }).shortfalls;

    expect(shortfall?.tradeoffs).toEqual([
      { kind: "exceed_daily_limit", gainedMinutes: 180, needsApproval: true },
      {
        kind: "free_time_from",
        workId: "essay",
        blockIds: ["b-essay"],
        gainedMinutes: 60,
        needsApproval: true,
      },
      { kind: "reduce_estimate", workId: "exam", byMinutes: 180 },
    ]);
  });

  it("keeps the study window on Berlin wall-clock time across the switch to summer time", () => {
    const summer = (local: string) =>
      new Date(`${local.replace(" ", "T")}:00+02:00`);
    const state = {
      ...base,
      now: at("2027-03-27 20:00"),
      obligations: [
        {
          id: "lab",
          due: summer("2027-03-29 18:00"),
          estimateMinutes: 300,
          priority: 1,
        },
      ],
    };
    expect(creates(state).map(({ start, end }) => ({ start, end }))).toEqual([
      // Sunday 28 March switches to CEST at 02:00; the window still opens at 09:00 local time.
      { start: summer("2027-03-28 09:00"), end: summer("2027-03-28 13:00") },
      { start: summer("2027-03-29 09:00"), end: summer("2027-03-29 10:00") },
    ]);
  });

  it("reports a block the calendar now overlaps when no time is left to move it to, never dropping it silently", () => {
    const lecture = span("2026-11-09 09:00", "2026-11-09 10:00");
    const block = {
      id: "b1",
      workId: "sheet-3",
      placedBy: "nunio" as const,
      locked: false,
      ...lecture,
    };
    // Due at 10:00 the same morning: nowhere to move the block before the deadline.
    const proposal = rebalance({
      ...base,
      obligations: [
        { ...sheet, due: at("2026-11-09 10:00"), estimateMinutes: 60 },
      ],
      fixedEvents: [lecture],
      studyBlocks: [block],
    });
    expect(proposal.moves).toEqual([]);
    expect(proposal.overlaps).toEqual([{ blockId: "b1", reason: "no_room" }]);
  });

  it("offers time just proposed for lower-Priority work due earlier as a tradeoff", () => {
    // The quiz is due first, so it is placed first, but the exam matters more.
    const quiz = {
      id: "quiz",
      due: at("2026-11-09 13:00"),
      estimateMinutes: 120,
      priority: 2,
    };
    const exam = {
      id: "exam",
      due: at("2026-11-10 10:00"),
      estimateMinutes: 360,
      priority: 1,
    };
    const [shortfall] = rebalance({
      ...base,
      obligations: [quiz, exam],
    }).shortfalls;
    expect(shortfall?.workId).toBe("exam");
    expect(shortfall?.tradeoffs).toContainEqual({
      kind: "free_time_from",
      workId: "quiz",
      blockIds: [],
      gainedMinutes: 120,
      needsApproval: false,
    });
  });

  it("keeps work within its own daily limit while the global limit still caps the day", () => {
    const thesis = {
      id: "thesis",
      due: at("2026-11-11 12:00"),
      estimateMinutes: 120,
      priority: 1,
      dailyLimitMinutes: 60,
    };
    const reading = {
      id: "reading",
      due: at("2026-11-11 12:00"),
      estimateMinutes: 240,
      priority: 2,
    };
    expect(
      creates({ ...base, obligations: [thesis, reading] }).map((m) => [
        m.workId,
        m.start,
        m.end,
      ]),
    ).toEqual([
      ["thesis", at("2026-11-09 09:00"), at("2026-11-09 10:00")],
      ["thesis", at("2026-11-10 09:00"), at("2026-11-10 10:00")],
      ["reading", at("2026-11-09 10:00"), at("2026-11-09 13:00")],
      ["reading", at("2026-11-10 10:00"), at("2026-11-10 11:00")],
    ]);
  });
});
