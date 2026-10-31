import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { hetzner, presignGet, presignPut, promote, sseCHeaders } from "@nunio/knowledge/spike-e";
import { origins } from "../origins.js";

// Spike e: the browser talks to Hetzner directly with presigned URLs plus the Source's SSE-C headers.
test.describe("SSE-C uploads from the browser", { tag: "@staging" }, () => {
  const { s3, buckets } = hetzner();

  const fetchFrom = (page: Page, url: string, init: { method?: string; headers: Record<string, string>; body?: string }) =>
    page.evaluate(
      async ({ url, init }) => {
        const body = init.body ? Uint8Array.from(atob(init.body), (c) => c.charCodeAt(0)) : undefined;
        try {
          const res = await fetch(url, { method: init.method ?? "GET", headers: init.headers, body });
          const bytes = new Uint8Array(await res.arrayBuffer());
          return { status: res.status, body: btoa(String.fromCharCode(...bytes)) };
        } catch (error) {
          return { status: 0, error: String(error) };
        }
      },
      { url, init },
    );

  test("the app origin uploads to quarantine and downloads from sources", async ({ page }) => {
    const key = randomBytes(32);
    const body = randomBytes(4096);
    const objectKey = `spike-e/${randomUUID()}`;
    await page.goto(`${origins.app}/sign-in`);

    const put = await presignPut(s3, { bucket: buckets.quarantine, objectKey, key, contentLength: body.length });
    const uploaded = await fetchFrom(page, put, { method: "PUT", headers: sseCHeaders(key), body: body.toString("base64") });
    expect(uploaded.status).toBe(200);

    await promote(s3, { from: buckets.quarantine, to: buckets.sources, objectKey, key });

    const get = await presignGet(s3, { bucket: buckets.sources, objectKey, key });
    const downloaded = await fetchFrom(page, get, { headers: sseCHeaders(key) });
    expect(downloaded).toEqual({ status: 200, body: body.toString("base64") });
  });

  test("an untrusted origin is blocked by CORS", async ({ page }) => {
    const key = randomBytes(32);
    const put = await presignPut(s3, {
      bucket: buckets.quarantine,
      objectKey: `spike-e/${randomUUID()}`,
      key,
      contentLength: 16,
    });
    await page.goto(`${origins.evil}/`);

    const res = await fetchFrom(page, put, { method: "PUT", headers: sseCHeaders(key), body: randomBytes(16).toString("base64") });
    expect(res.status).toBe(0);
  });
});
