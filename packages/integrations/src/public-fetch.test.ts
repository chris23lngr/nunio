import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicFetch } from "./public-fetch.js";
import { createCertificate } from "./testing/certificate.js";

describe("waiting between a response's body chunks", () => {
  const certificate = createCertificate(["DNS:localhost", "IP:::1"]);
  const defaultCAs = getCACertificates("default");
  // An event stream that goes quiet for a while between two events.
  const quiet = createServer(certificate, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: first\n\n");
    setTimeout(() => res.end("data: second\n\n"), 2_500);
  });
  const url = () => `https://[::1]:${(quiet.address() as AddressInfo).port}/`;
  /** As nunio's guard, but treating the IPv6 loopback as the public internet. */
  const guarded = (options: { bodyTimeoutMs?: number }) =>
    publicFetch(false, {
      timeoutMs: 1_000,
      allowed: (address) => address === "::1",
      purpose: "MCP",
      ...options,
    });

  beforeAll(async () => {
    setDefaultCACertificates([...defaultCAs, certificate.ca]);
    await new Promise<void>((resolve) => quiet.listen(0, "::1", resolve));
  });

  afterAll(async () => {
    setDefaultCACertificates(defaultCAs);
    quiet.closeAllConnections();
    await new Promise((resolve) => quiet.close(resolve));
  });

  it("gives up on a body that goes quiet for longer than the timeout", async () => {
    const response = await guarded({})(url());

    await expect(response.text()).rejects.toThrow();
  });

  it("waits as long as it takes when the body timeout is off, as for an SSE stream", async () => {
    const response = await guarded({ bodyTimeoutMs: 0 })(url());

    expect(await response.text()).toBe("data: first\n\ndata: second\n\n");
  });
});
