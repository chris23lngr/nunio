// Spike c only (docs/operations/spike-results.md): mounted when SPIKE_ROUTES=true, deleted once billing
// brings the real Stripe webhook.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "@nunio/db";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

export interface SpikeDeps {
  /** HMAC-SHA256 key for `x-spike-signature`, standing in for a Stripe endpoint secret. */
  webhookSecret: string;
  pool: Pool;
}

/** One id per function instance, so pool stats from different Fluid instances can be told apart. */
const instanceId = randomUUID();

/** Tags every response with the instance that served it and its pool counts before and after. */
export function spikePoolHeader(pool: Pool) {
  const counts = () => `total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`;
  return createMiddleware(async (c, next) => {
    const before = counts();
    await next();
    c.header("x-spike-instance", instanceId);
    c.header("x-spike-pool-before", before);
    c.header("x-spike-pool", counts());
  });
}

export function spikeRoutes({ webhookSecret }: SpikeDeps) {
  // Stripe-style: the signature covers the raw bytes, so the handler must never re-serialise.
  return new Hono().post("/spike/raw-body", async (c) => {
    const body = Buffer.from(await c.req.arrayBuffer());
    const expected = createHmac("sha256", webhookSecret).update(body).digest();
    const given = Buffer.from(c.req.header("x-spike-signature") ?? "", "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ verified: false }, 401);
    }
    return c.json({ verified: true, bytes: body.length }, 200);
  });
}
