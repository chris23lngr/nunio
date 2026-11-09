import { describe, expect, it } from "vitest";
import { createScalewayMailer } from "./index.js";

/** Records what reached Scaleway, answering with `status`. */
function scaleway(status = 200) {
  const requests: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response("{}", { status });
  };
  return { requests, fetch };
}

describe("the Scaleway mailer", () => {
  it("sends one email through Scaleway Transactional Email in France", async () => {
    const tem = scaleway();
    const mailer = createScalewayMailer({
      projectId: "test-project",
      secretKey: "test-notify-key",
      from: "notifications@nunio.test",
      fetch: tem.fetch,
    });

    await mailer.send("student@example.com", {
      subject: "nunio: 1 item needs your attention",
      text: "https://app.nunio.test/inbox",
    });

    expect(tem.requests).toEqual([
      {
        url: "https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails",
        headers: expect.any(Headers),
        body: {
          project_id: "test-project",
          from: { email: "notifications@nunio.test", name: "nunio" },
          to: [{ email: "student@example.com" }],
          subject: "nunio: 1 item needs your attention",
          text: "https://app.nunio.test/inbox",
        },
      },
    ]);
    expect(tem.requests[0]!.headers.get("x-auth-token")).toBe(
      "test-notify-key",
    );
  });

  it("passes extra headers on to Scaleway, such as one-click unsubscribe", async () => {
    const tem = scaleway();
    const mailer = createScalewayMailer({
      projectId: "test-project",
      secretKey: "test-notify-key",
      from: "notifications@nunio.test",
      fetch: tem.fetch,
    });

    await mailer.send("student@example.com", {
      subject: "Your nunio Briefing is ready",
      text: "https://app.nunio.test/inbox",
      headers: {
        "List-Unsubscribe": "<https://api.nunio.test/unsubscribe?t=1>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    expect(tem.requests[0]!.body).toEqual(
      expect.objectContaining({
        additional_headers: [
          {
            key: "List-Unsubscribe",
            value: "<https://api.nunio.test/unsubscribe?t=1>",
          },
          {
            key: "List-Unsubscribe-Post",
            value: "List-Unsubscribe=One-Click",
          },
        ],
      }),
    );
  });

  it("fails when Scaleway does not accept the email", async () => {
    const mailer = createScalewayMailer({
      projectId: "test-project",
      secretKey: "test-notify-key",
      from: "notifications@nunio.test",
      fetch: scaleway(503).fetch,
    });

    await expect(
      mailer.send("student@example.com", { subject: "s", text: "t" }),
    ).rejects.toThrow();
  });
});
