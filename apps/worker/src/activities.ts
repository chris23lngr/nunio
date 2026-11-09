// Spike d/g Activities: all I/O lives here, never in workflow code.
import { setTimeout } from "node:timers/promises";
import { log } from "./log.js";

export interface ActivityDeps {
  /** The parser's private address on Render (ADR-0009), e.g. http://nunio-parser-staging:10000. */
  parserUrl: string;
}

export function createActivities({ parserUrl }: ActivityDeps) {
  return {
    /** Stands in for real work, so shutdown can be observed while an Activity is in flight. */
    async hold(ms: number): Promise<number> {
      log("activity started", { ms });
      await setTimeout(ms);
      log("activity finished", { ms });
      return ms;
    },

    /** Proves the worker reaches the parser over the private network. */
    async checkParser(): Promise<{ status: string }> {
      const res = await fetch(`${parserUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`parser health returned ${res.status}`);
      return (await res.json()) as { status: string };
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
