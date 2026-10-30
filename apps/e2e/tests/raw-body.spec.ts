import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { origins, spikeWebhookSecret } from "../origins.js";

// Spike c: the deployed handler must see the exact bytes the sender signed, as Stripe webhooks need.
const signedBody = '{"id":"evt_1","type":"invoice.paid","amount":1999}';

test.describe("the spike raw-body route", () => {
  const signature = createHmac("sha256", spikeWebhookSecret).update(signedBody).digest("hex");

  const post = (request: APIRequestContext, body: string) =>
    request.post(`${origins.api}/spike/raw-body`, {
      headers: { "content-type": "application/json", "x-spike-signature": signature },
      data: Buffer.from(body),
    });

  test("accepts the exact bytes that were signed", async ({ request }) => {
    const res = await post(request, signedBody);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ verified: true, bytes: 50 });
  });

  test("rejects a body with one byte changed", async ({ request }) => {
    expect((await post(request, signedBody.replace("1999", "1998"))).status()).toBe(401);
  });

  test("rejects the same JSON with its keys reordered", async ({ request }) => {
    const reordered = '{"type":"invoice.paid","id":"evt_1","amount":1999}';
    expect((await post(request, reordered)).status()).toBe(401);
  });
});
