import type { ParsedPdf } from "./pdf.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParserServer } from "./server.js";

const server = createParserServer({ quarantineBucket: "test" });
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("parser server", () => {
  it("reports health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

it("refuses an arbitrary URL before fetching it", async () => {
  const res = await fetch(`${base}/parse`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data", keyBase64: Buffer.alloc(32).toString("base64"), expectedBytes: 100 }) });
  expect(res.status).toBe(400);
});

it("rejects a mislabeled upload instead of returning passages", async () => {
  const parser = createParserServer({ quarantineBucket: "test", fetch: async () => new Response("not a PDF") });
  await new Promise<void>(resolve => parser.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(parser.address() as AddressInfo).port}/parse`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        url: "https://fsn1.your-objectstorage.com/test/source", keyBase64: Buffer.alloc(32).toString("base64"), expectedBytes: 9,
      }),
    });
    expect(response.status).toBe(422);
  } finally { await new Promise<void>(resolve => parser.close(() => resolve())); }
});

async function parseUpload(bytes: Buffer, expectedBytes = bytes.length) {
  const parser = createParserServer({ quarantineBucket: "test", fetch: async () => new Response(new Uint8Array(bytes)) });
  await new Promise<void>(resolve => parser.listen(0, resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(parser.address() as AddressInfo).port}/parse`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        url: "https://fsn1.your-objectstorage.com/test/source", keyBase64: Buffer.alloc(32).toString("base64"), expectedBytes,
      }),
    });
    return { status: res.status, body: await res.json() as ParsedPdf };
  } finally { await new Promise<void>(resolve => parser.close(() => resolve())); }
}
it("extracts a real PDF and renders pages without text for the worker", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  const text = await parseUpload(pdfFixture());
  expect(text.status).toBe(200);
  expect(text.body.pages[0]!.text).toContain("examination");
  expect(text.body.pages[0]!.imageBase64).toBeUndefined();
  const scan = await parseUpload(pdfFixture({ text: "" }));
  expect(scan.status).toBe(200);
  expect(Buffer.from(scan.body.pages[0]!.imageBase64!, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});
it("keeps a text-rich page with a logo as extracted text, without rendering it", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  const parsed = await parseUpload(pdfFixture({ image: true }));
  expect(parsed.status).toBe(200);
  expect(parsed.body.pages[0]!.text).toContain("examination");
  expect(parsed.body.pages[0]!.imageBase64).toBeUndefined();
});
it("refuses byte mismatches, malformed PDFs, excessive pages and compressed bombs", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  expect((await parseUpload(pdfFixture(), 10)).status).toBe(413);
  expect((await parseUpload(Buffer.from("%PDF-1.7\ngarbage"))).status).toBe(422);
  expect((await parseUpload(pdfFixture({ pages: 101 }))).status).toBe(413);
  expect((await parseUpload(pdfFixture({ bomb: true }))).status).toBe(422);
});

it("preserves German characters in born-digital pages", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  const parsed = await parseUpload(pdfFixture({ text: "Pr\\374fung am 12. M\\344rz in Raum H1." }));
  expect(parsed.status).toBe(200);
  expect(parsed.body.pages[0]!.text).toContain("Prüfung am 12. März");
});
