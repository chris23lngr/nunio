import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oauthFetch } from "./oauth.js";

describe("the fetch OAuth requests go through", () => {
  // Stands in for an internal service, such as a cloud metadata endpoint, that a vendor's metadata could name.
  const internal = createServer((_req, res) => res.end("internal"));
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      internal.listen(0, "127.0.0.1", resolve),
    );
    port = (internal.address() as AddressInfo).port;
  });

  afterAll(() => new Promise((resolve) => internal.close(resolve)));

  it("refuses hosts that resolve to non-public addresses, by name as well as by address", async () => {
    const guarded = oauthFetch(false);
    for (const host of ["127.0.0.1", "localhost"])
      await expect(guarded(`http://${host}:${port}/`)).rejects.toThrow();
  });

  it("reaches private hosts under INTEGRATION_FAKES", async () => {
    const response = await oauthFetch(true)(`http://localhost:${port}/`);
    expect(await response.text()).toBe("internal");
  });
});
