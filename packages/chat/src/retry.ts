import { setTimeout as sleep } from "node:timers/promises";
import { isDefiniteFailure, isTransientFailure } from "@nunio/ai";
import { DefiniteFailure } from "@nunio/delegation";
import { APICallError } from "ai";

/** How long to wait before each further attempt when the provider does not say. */
const retryDelaysMs = [1_000, 3_000];
/** The longest a step waits for the provider in all, so the student is not left waiting. */
const maxWaitMs = 10_000;

/**
 * Runs a metered step again when the provider rate-limited it: a rejection that certainly cost nothing and may pass
 * later. Each attempt is metered on its own, and a longer wait than the provider asks for is never shortened.
 */
export async function retryRateLimited<T>(
  attempt: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let waitedMs = 0;
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      const cause = error instanceof DefiniteFailure ? error.cause : error;
      if (
        n >= retryDelaysMs.length ||
        !isDefiniteFailure(cause) ||
        !isTransientFailure(cause)
      )
        throw error;
      const asked = APICallError.isInstance(cause)
        ? Number(cause.responseHeaders?.["retry-after"]) * 1_000
        : Number.NaN;
      const delayMs = Number.isFinite(asked) ? asked : retryDelaysMs[n]!;
      if (waitedMs + delayMs > maxWaitMs) throw error;
      waitedMs += delayMs;
      await sleep(delayMs, undefined, { signal });
    }
  }
}
