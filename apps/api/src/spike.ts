// Spike c only (docs/operations/spike-results.md): mounted when SPIKE_ROUTES=true, deleted once billing
// brings the real Stripe webhook.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "@nunio/db";
import { Hono } from "hono";

export interface SpikeDeps {
  /** HMAC-SHA256 key for `x-spike-signature`, standing in for a Stripe endpoint secret. */
  webhookSecret: string;
  pool: Pool;
}

/** One id per function instance, so pool stats from different Fluid instances can be told apart. */
const instanceId = randomUUID();

export function spikeRoutes({ webhookSecret, pool }: SpikeDeps) {
  return (
    new Hono()
      // Stripe-style: the signature covers the raw bytes, so the handler must never re-serialise.
      .post("/spike/raw-body", async (c) => {
        const body = Buffer.from(await c.req.arrayBuffer());
        const expected = createHmac("sha256", webhookSecret).update(body).digest();
        const given = Buffer.from(c.req.header("x-spike-signature") ?? "", "hex");
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
          return c.json({ verified: false }, 401);
        }
        return c.json({ verified: true, bytes: body.length }, 200);
      })
      .get("/spike/pool", (c) =>
        c.json({
          instanceId,
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
        }),
      )
  );
}
