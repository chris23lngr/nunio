import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oauthFetch } from "./oauth.js";
import { createCertificate } from "./testing/certificate.js";

describe("the fetch OAuth requests go through", () => {
  const certificate = createCertificate([
    "DNS:localhost",
    "IP:127.0.0.1",
    "IP:::1",
  ]);
  const defaultCAs = getCACertificates("default");
  // Stands in for an internal service, such as a cloud metadata endpoint, that a vendor could point nunio at.
  let internalHits = 0;
  const internal = createHttpsServer(certificate, (_req, res) => {
    internalHits++;
    res.end("internal");
  });
  // Stands in for a public host that redirects to the internal one.
  const redirecting = createHttpsServer(certificate, (_req, res) =>
    res
      .writeHead(302, {
        location: `https://127.0.0.1:${port(internal)}/latest/meta-data`,
      })
      .end(),
  );
  const plain = createHttpServer((_req, res) => res.end("plain"));
  const port = (server: { address(): unknown }) =>
    (server.address() as AddressInfo).port;
  /** As nunio's guard, but treating the IPv6 loopback as the public internet, so a local server can play one. */
  const guarded = () => oauthFetch(false, (address) => address === "::1");

  beforeAll(async () => {
    setDefaultCACertificates([...defaultCAs, certificate.ca]);
    await Promise.all([
      new Promise<void>((resolve) => internal.listen(0, "127.0.0.1", resolve)),
      new Promise<void>((resolve) => redirecting.listen(0, "::1", resolve)),
      new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve)),
    ]);
  });

  afterAll(async () => {
    setDefaultCACertificates(defaultCAs);
    for (const server of [internal, redirecting, plain])
      await new Promise((resolve) => server.close(resolve));
  });

  it("refuses hosts that resolve to non-public addresses, by name as well as by address", async () => {
    for (const host of ["127.0.0.1", "localhost"])
      await expect(
        guarded()(`https://${host}:${port(internal)}/`),
      ).rejects.toThrow();
    expect(internalHits).toBe(0);
  });

  it("refuses plain http, which would carry codes, verifiers and client secrets in the clear", async () => {
    await expect(oauthFetch(false)("http://example.com/")).rejects.toThrow(
      "OAuth requests use https only",
    );
  });

  it("never follows a redirect, so a public host can't send nunio to an internal one", async () => {
    const from = `https://[::1]:${port(redirecting)}/`;

    await expect(guarded()(from)).rejects.toThrow();
    await expect(guarded()(from, { redirect: "follow" })).rejects.toThrow(
      "OAuth requests don't follow redirects",
    );
    // The SDK follows by hand, validating each hop; the next hop is refused at connect.
    const manual = await guarded()(from, { redirect: "manual" });
    expect(manual.status).toBe(302);
    await expect(
      guarded()(manual.headers.get("location")!, { redirect: "manual" }),
    ).rejects.toThrow();

    expect(internalHits).toBe(0);
  });

  it("reaches private hosts over http under INTEGRATION_FAKES", async () => {
    const response = await oauthFetch(true)(`http://localhost:${port(plain)}/`);
    expect(await response.text()).toBe("plain");
  });
});
