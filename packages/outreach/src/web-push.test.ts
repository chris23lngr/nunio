import { describe, expect, it } from "vitest";
import webpush from "web-push";
import { createWebPusher } from "./index.js";

const keys = webpush.generateVAPIDKeys();
const subscription = {
  endpoint: "https://push.example.test/send/abc",
  keys: { p256dh: "BNcR-test-key", auth: "test-auth" },
};

/** Stands in for a push service: records each request and answers with `status`. */
function pushService(status: number) {
  const requests: {
    url: string;
    method: string;
    headers: Headers;
    body: string;
  }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers as Record<string, string>),
      body: init?.body ? String(init.body) : "",
    });
    return new Response(null, { status });
  };
  return { requests, fetch };
}

const pusherFor = (fetch: typeof globalThis.fetch) =>
  createWebPusher({
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: "mailto:founder@nunio.test",
    fetch,
  });

describe("the web push sender", () => {
  it("sends an empty, VAPID-signed push with its TTL and urgency", async () => {
    const service = pushService(201);

    const outcome = await pusherFor(service.fetch).send(subscription, {
      ttlSeconds: 43_200,
      urgency: "low",
    });

    expect(outcome).toBe("sent");
    const [request] = service.requests;
    expect(request).toMatchObject({
      url: subscription.endpoint,
      method: "POST",
      body: "",
    });
    expect(request!.headers.get("TTL")).toBe("43200");
    expect(request!.headers.get("Urgency")).toBe("low");
    expect(request!.headers.get("Authorization")).toMatch(
      new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`),
    );
  });

  it.each([404, 410])(
    "reports a subscription the push service answers %i for as gone",
    async (status) => {
      const outcome = await pusherFor(pushService(status).fetch).send(
        subscription,
        { ttlSeconds: 60, urgency: "normal" },
      );

      expect(outcome).toBe("gone");
    },
  );

  it("fails on any other answer, so the push is tried again", async () => {
    await expect(
      pusherFor(pushService(500).fetch).send(subscription, {
        ttlSeconds: 60,
        urgency: "normal",
      }),
    ).rejects.toThrow();
  });

  it("names its public key, which each subscription records", () => {
    expect(pusherFor(pushService(201).fetch).keyId).toBe(keys.publicKey);
  });
});
