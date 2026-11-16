/** What the grouping pass (ADR-0023) shows the model: a Course's Topics in document order and its current Areas. */
export interface GroupingInput {
  topics: {
    /** A short handle such as "t3", never a database ID. */
    handle: string;
    name: string;
    source: string;
    page: number;
    quote: string;
    /** The Topic's current Area, or null when it has none yet. */
    area: string | null;
  }[];
  /** The Course's Areas, including renamed ones by their current name; rejected ones must not be reused. */
  areas: { name: string; rejected: boolean }[];
}
export interface Grouped {
  areas: { name: string; topics: string[] }[];
}
export interface Grouper {
  model: string;
  estimateMicroUsd(input: GroupingInput): number;
  group(
    input: GroupingInput,
    options: { signal: AbortSignal },
  ): Promise<{ value: Grouped; usage: { microUsd: number } }>;
}
