export interface Interval {
  start: Date;
  end: Date;
}

export interface PlanState {
  now: Date;
  /** The student's time zone; study windows and daily limits apply to its local days. */
  timeZone: string;
  /** `dailyLimitMinutes` is the work's own Preference, already resolved task over course; the global limit still caps each day. */
  obligations: {
    id: string;
    due: Date | null;
    estimateMinutes: number | null;
    priority: number;
    dailyLimitMinutes?: number | null;
  }[];
  tasks: {
    id: string;
    obligationId: string | null;
    estimateMinutes: number | null;
    done: boolean;
    dailyLimitMinutes?: number | null;
    /** A window of a Task toward no Obligation, such as a Course Event's Follow-up (ADR-0022). */
    earliest?: Date | null;
    due?: Date | null;
    /** A Task toward no Obligation ranks as its Course does; one toward an Obligation as the Obligation. */
    priority?: number;
    /** The Routine, by its Event Series, that a Preparation or Follow-up comes from. */
    routine?: string | null;
  }[];
  studyBlocks: {
    id: string;
    workId: string;
    start: Date;
    end: Date;
    placedBy: "nunio" | "student";
    locked: boolean;
  }[];
  fixedEvents: Interval[];
  protectedTime: Interval[];
  preferences: {
    studyWindow: { fromMinute: number; toMinute: number };
    maxMinutesPerDay: number;
  };
}

export type Move =
  | {
      kind: "create";
      workId: string;
      start: Date;
      end: Date;
      needsApproval: boolean;
    }
  /** Moving a block the student placed needs Approval; a Locked block is never moved. */
  | {
      kind: "move";
      blockId: string;
      workId: string;
      from: Interval;
      to: Interval;
      needsApproval: boolean;
    };

/** A way to close a Shortfall; the student chooses, nunio never resolves it silently. */
export type Tradeoff =
  /** Study beyond the daily limit: breaking a Preference needs Approval. */
  | { kind: "exceed_daily_limit"; gainedMinutes: number; needsApproval: true }
  /** Give up blocks planned for lower-Priority work before the deadline; the student's own need Approval to move. */
  | {
      kind: "free_time_from";
      workId: string;
      blockIds: string[];
      gainedMinutes: number;
      needsApproval: boolean;
    }
  | { kind: "reduce_estimate"; workId: string; byMinutes: number }
  /** Skip a Routine until the deadline: its Preparations and Follow-ups give up their time (ADR-0022). */
  | {
      kind: "skip_routine";
      routine: string;
      /** The Event Series' title, which the Plan adds, so two such tradeoffs can be told apart. */
      title?: string;
      until: Date;
      gainedMinutes: number;
    };

export interface Shortfall {
  workId: string;
  due: Date;
  shortMinutes: number;
  tradeoffs: Tradeoff[];
}

export type Unplanned = {
  workId: string;
  reason: "no_estimate" | "no_deadline" | "past_due";
};

/** A Study Block the calendar now overlaps that stays put: Locked, or with no time left to move it to before its deadline. */
export type Overlap = { blockId: string; reason: "locked" | "no_room" };

export interface Proposal {
  moves: Move[];
  /** Obligations nunio cannot plan, so none is ever dropped silently. */
  unplanned: Unplanned[];
  shortfalls: Shortfall[];
  /** Blocks shown to the student because they overlap the calendar and are not moved. */
  overlaps: Overlap[];
}

const slotMinutes = 30;
const slotMs = slotMinutes * 60_000;
const dayMs = 24 * 60 * 60_000;

/** The local calendar date and minute of day of an instant. */
export function local(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(ms)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const overlaps = (intervals: readonly Interval[], start: number, end: number) =>
  intervals.some(
    (interval) =>
      interval.start.getTime() < end && start < interval.end.getTime(),
  );

/** Counts an interval's minutes towards the local days it falls on. */
export function addMinutes(
  perDay: Map<string, number>,
  { start, end }: Interval,
  timeZone: string,
) {
  for (let ms = start.getTime(); ms < end.getTime(); ms += slotMs) {
    const { date } = local(ms, timeZone);
    perDay.set(
      date,
      (perDay.get(date) ?? 0) + Math.min(slotMs, end.getTime() - ms) / 60_000,
    );
  }
}

const minutes = ({ start, end }: Interval) =>
  (end.getTime() - start.getTime()) / 60_000;
/** How far ahead work without a deadline may be placed. */
const horizonMs = 14 * dayMs;

/**
 * What needs time: an Obligation's open Tasks, each with its deadline and Priority, or the Obligation itself when it
 * has no Tasks; and Tasks of no Obligation, which have no deadline.
 */
function workOf({ obligations, tasks }: PlanState) {
  return [
    ...obligations.flatMap((obligation) => {
      const own = tasks.filter((task) => task.obligationId === obligation.id);
      if (!own.length)
        return [
          {
            ...obligation,
            earliest: null,
            dailyLimitMinutes: obligation.dailyLimitMinutes ?? null,
          },
        ];
      return own
        .filter((task) => !task.done)
        .map((task) => ({
          id: task.id,
          due: obligation.due,
          estimateMinutes: task.estimateMinutes,
          priority: obligation.priority,
          earliest: null,
          dailyLimitMinutes: task.dailyLimitMinutes ?? null,
        }));
    }),
    ...tasks
      .filter((task) => !task.obligationId && !task.done)
      .map((task) => ({
        id: task.id,
        due: task.due ?? null,
        earliest: task.earliest ?? null,
        estimateMinutes: task.estimateMinutes,
        priority: task.priority ?? Infinity,
        dailyLimitMinutes: task.dailyLimitMinutes ?? null,
      })),
  ];
}

/** Pure: proposes how to arrange the Plan, writing nothing. */
export function rebalance(state: PlanState): Proposal {
  const {
    timeZone,
    preferences: { studyWindow, maxMinutesPerDay },
  } = state;
  const calendar = [...state.fixedEvents, ...state.protectedTime];
  const works = workOf(state);
  const conflicting = state.studyBlocks.filter((block) =>
    overlaps(calendar, block.start.getTime(), block.end.getTime()),
  );
  const overlapping: Overlap[] = conflicting
    .filter((block) => block.locked)
    .map((block) => ({ blockId: block.id, reason: "locked" }));
  /** A block still ahead that lies outside its work's window, as when its Course Event moved. */
  const outsideWindow = (block: PlanState["studyBlocks"][number]) => {
    const work = works.find((w) => w.id === block.workId);
    return (
      block.start >= state.now &&
      Boolean(work?.earliest && work.due) &&
      (block.start < work!.earliest! || block.end > work!.due!)
    );
  };
  // A block the calendar now overlaps, or outside its window, leaves the Plan to be placed again, unless it is Locked.
  const displaced = state.studyBlocks.filter(
    (block) =>
      !block.locked && (conflicting.includes(block) || outsideWindow(block)),
  );
  const kept = state.studyBlocks.filter((block) => !displaced.includes(block));
  const usedPerDay = new Map<string, number>();
  for (const block of kept) addMinutes(usedPerDay, block, timeZone);
  const busy: Interval[] = [...calendar, ...kept];
  const taken = new Set<number>();
  const moves: Move[] = [];
  const shortfalls: Shortfall[] = [];
  const first = Math.ceil(state.now.getTime() / slotMs) * slotMs;
  /** The first slot a work may take: now, or its window's start. */
  const startOf = (work: { earliest: Date | null } | undefined) =>
    work?.earliest
      ? Math.max(first, Math.ceil(work.earliest.getTime() / slotMs) * slotMs)
      : first;
  const dueOf = (workId: string) =>
    works.find((work) => work.id === workId)?.due?.getTime() ??
    first + horizonMs;

  /** Minutes placed per work and local day, for work with its own daily limit. */
  const usedByWork = new Map<string, number>();
  const limitOf = (workId: string) =>
    works.find((work) => work.id === workId)?.dailyLimitMinutes ?? null;
  /** A study slot nothing occupies; `withinLimit` also keeps the day, and the work's own day, within their limits. */
  const open = (slot: number, withinLimit: boolean, workId?: string) => {
    const { date, minute } = local(slot, timeZone);
    if (
      minute < studyWindow.fromMinute ||
      minute + slotMinutes > studyWindow.toMinute ||
      taken.has(slot) ||
      overlaps(busy, slot, slot + slotMs)
    )
      return false;
    if (!withinLimit) return true;
    const own = workId ? limitOf(workId) : null;
    return (
      (usedPerDay.get(date) ?? 0) + slotMinutes <= maxMinutesPerDay &&
      (own === null ||
        (usedByWork.get(`${workId}|${date}`) ?? 0) + slotMinutes <= own)
    );
  };
  const take = (slot: number, workId: string) => {
    const { date } = local(slot, timeZone);
    usedPerDay.set(date, (usedPerDay.get(date) ?? 0) + slotMinutes);
    usedByWork.set(
      `${workId}|${date}`,
      (usedByWork.get(`${workId}|${date}`) ?? 0) + slotMinutes,
    );
    taken.add(slot);
  };

  const moved: { workId: string; to: Interval }[] = [];
  for (const block of displaced) {
    const slots = Math.ceil(minutes(block) / slotMinutes),
      due = dueOf(block.workId);
    let placed = false;
    for (
      let start = startOf(works.find((w) => w.id === block.workId));
      start + slots * slotMs <= due && !placed;
      start += slotMs
    ) {
      const run = Array.from({ length: slots }, (_, i) => start + i * slotMs);
      if (!run.every((slot) => open(slot, true, block.workId))) continue;
      for (const slot of run) take(slot, block.workId);
      const to = {
        start: new Date(start),
        end: new Date(start + slots * slotMs),
      };
      moves.push({
        kind: "move",
        blockId: block.id,
        workId: block.workId,
        from: { start: block.start, end: block.end },
        to,
        needsApproval: block.placedBy === "student",
      });
      moved.push({ workId: block.workId, to });
      placed = true;
    }
    if (!placed) overlapping.push({ blockId: block.id, reason: "no_room" });
  }

  const unplanned = works.flatMap((work): Unplanned[] =>
    !work.due
      ? [{ workId: work.id, reason: "no_deadline" }]
      : work.due.getTime() <= state.now.getTime()
        ? [{ workId: work.id, reason: "past_due" }]
        : !work.estimateMinutes
          ? [{ workId: work.id, reason: "no_estimate" }]
          : [],
  );
  // Earliest deadline first: it fits the most work before each deadline. Priority (1 is highest) breaks ties.
  const ordered = [...works].sort(
    (a, b) =>
      (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) ||
      a.priority - b.priority,
  );
  for (const work of ordered) {
    if (
      !work.due ||
      !work.estimateMinutes ||
      unplanned.some((u) => u.workId === work.id)
    )
      continue;
    const due = work.due.getTime();
    // Work with a window starts no earlier than its window does.
    const start = startOf(work);
    // Time the Plan already holds for this work before its deadline counts towards the Estimate.
    const planned = [
      ...kept.filter((block) => block.workId === work.id),
      ...moved.filter((m) => m.workId === work.id).map((m) => m.to),
    ].filter((interval) => interval.end.getTime() <= due);
    let remaining =
      work.estimateMinutes -
      planned.reduce((sum, interval) => sum + minutes(interval), 0);
    for (
      let slot = start;
      slot + slotMs <= due && remaining > 0;
      slot += slotMs
    ) {
      if (!open(slot, true, work.id)) continue;
      take(slot, work.id);
      remaining -= slotMinutes;
      const previous = moves.at(-1);
      if (
        previous?.kind === "create" &&
        previous.workId === work.id &&
        previous.end.getTime() === slot
      )
        previous.end = new Date(slot + slotMs);
      else
        moves.push({
          kind: "create",
          workId: work.id,
          start: new Date(slot),
          end: new Date(slot + slotMs),
          needsApproval: false,
        });
    }
    if (remaining > 0) {
      let beyondLimit = 0;
      for (let slot = start; slot + slotMs <= due; slot += slotMs)
        if (open(slot, false)) beyondLimit += slotMinutes;
      const tradeoffs: Tradeoff[] = [];
      if (beyondLimit)
        tradeoffs.push({
          kind: "exceed_daily_limit",
          gainedMinutes: Math.min(beyondLimit, remaining),
          needsApproval: true,
        });
      const lower = works.filter((other) => other.priority > work.priority);
      for (const other of lower) {
        // Existing blocks, and time this proposal just placed for it, before the deadline.
        const blocks = kept.filter(
          (block) =>
            block.workId === other.id &&
            !block.locked &&
            block.start.getTime() < due,
        );
        const proposed = moves.filter(
          (move) =>
            move.kind === "create" &&
            move.workId === other.id &&
            move.start.getTime() < due,
        ) as Extract<Move, { kind: "create" }>[];
        const gainedMinutes = [...blocks, ...proposed].reduce(
          (sum, interval) => sum + minutes(interval),
          0,
        );
        if (!gainedMinutes) continue;
        tradeoffs.push({
          kind: "free_time_from",
          workId: other.id,
          blockIds: blocks.map((block) => block.id),
          gainedMinutes,
          needsApproval: blocks.some((block) => block.placedBy === "student"),
        });
      }
      // Skipping a Routine is the student's choice, so it is offered whatever the Routine's Priority.
      const routines = new Map<string, number>();
      // Skipping the Routine the short work comes from would only take time from it.
      const own = state.tasks.find((task) => task.id === work.id)?.routine;
      for (const task of state.tasks) {
        if (!task.routine || task.routine === own) continue;
        const time = [
          ...kept.filter(
            (b) => b.workId === task.id && !b.locked && b.start.getTime() < due,
          ),
          ...moves.filter(
            (m) =>
              m.kind === "create" &&
              m.workId === task.id &&
              m.start.getTime() < due,
          ),
        ] as Interval[];
        const gained = time.reduce((sum, i) => sum + minutes(i), 0);
        if (gained)
          routines.set(
            task.routine,
            (routines.get(task.routine) ?? 0) + gained,
          );
      }
      for (const [routine, gainedMinutes] of routines)
        tradeoffs.push({
          kind: "skip_routine",
          routine,
          until: work.due,
          gainedMinutes,
        });
      tradeoffs.push({
        kind: "reduce_estimate",
        workId: work.id,
        byMinutes: remaining,
      });
      shortfalls.push({
        workId: work.id,
        due: work.due,
        shortMinutes: remaining,
        tradeoffs,
      });
    }
  }
  return { moves, unplanned, shortfalls, overlaps: overlapping };
}
