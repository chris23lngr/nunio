import { differenceInMinutes, setHours, startOfDay } from "date-fns";

export const HOUR_PX = 32;

/** Pixel position of an entry in a day column whose first row is `fromHour`. */
export function entryGeometry(fromHour: number, start: Date, end: Date) {
  const gridStart = setHours(startOfDay(start), fromHour);
  return {
    top: (differenceInMinutes(start, gridStart) / 60) * HOUR_PX,
    height: (differenceInMinutes(end, start) / 60) * HOUR_PX,
  };
}

type Timed = { start: Date; end: Date };

/**
 * Splits one day's entries into side-by-side lanes. Entries that overlap,
 * directly or through a chain, form a cluster; the earliest start takes the
 * left lane, the rest the lowest free one, and all share the cluster's count.
 */
export function assignLanes<T extends Timed>(
  entries: T[],
): (T & { lane: number; lanes: number })[] {
  const sorted = [...entries].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const placed: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let clusterEnd = 0;

  for (const entry of sorted) {
    if (cluster.length > 0 && entry.start.getTime() >= clusterEnd) {
      cluster = [];
    }
    const busy = new Set(
      cluster.filter((other) => other.end > entry.start).map((o) => o.lane),
    );
    let lane = 0;
    while (busy.has(lane)) lane++;
    const item = { ...entry, lane, lanes: 0 };
    cluster.push(item);
    placed.push(item);
    clusterEnd = Math.max(clusterEnd, entry.end.getTime());
    const lanes = Math.max(...cluster.map((o) => o.lane)) + 1;
    for (const member of cluster) member.lanes = lanes;
  }
  return placed;
}

/** Under two hours a card fits one line; sharing a column leaves no room for the time. */
export function displayForm(start: Date, end: Date, lanes: number) {
  return {
    compact: differenceInMinutes(end, start) < 120,
    narrow: lanes > 1,
  };
}
