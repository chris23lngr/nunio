// Spike d Activities: all I/O lives here, never in workflow code.
import { setTimeout } from "node:timers/promises";
import { log } from "./log.js";

/** Stands in for real work, so shutdown can be observed while an Activity is in flight. */
export async function hold(ms: number): Promise<number> {
  log("activity started", { ms });
  await setTimeout(ms);
  log("activity finished", { ms });
  return ms;
}
