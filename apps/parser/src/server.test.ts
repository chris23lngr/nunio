import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParsedPdf } from "./pdf.js";
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
  const res = await fetch(`${base}/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "http://169.254.169.254/latest/meta-data",
      keyBase64: Buffer.alloc(32).toString("base64"),
      expectedBytes: 100,
    }),
  });
  expect(res.status).toBe(400);
});

it("rejects a mislabeled upload instead of returning passages", async () => {
  const parser = createParserServer({
    quarantineBucket: "test",
    fetch: async () => new Response("not a PDF"),
  });
  await new Promise<void>((resolve) => parser.listen(0, resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${(parser.address() as AddressInfo).port}/parse`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://fsn1.your-objectstorage.com/test/source",
          keyBase64: Buffer.alloc(32).toString("base64"),
          expectedBytes: 9,
        }),
      },
    );
    expect(response.status).toBe(422);
  } finally {
    await new Promise<void>((resolve) => parser.close(() => resolve()));
  }
});

async function parseUpload(bytes: Buffer, expectedBytes = bytes.length) {
  const parser = createParserServer({
    quarantineBucket: "test",
    fetch: async () => new Response(new Uint8Array(bytes)),
  });
  await new Promise<void>((resolve) => parser.listen(0, resolve));
  try {
    const res = await fetch(
      `http://127.0.0.1:${(parser.address() as AddressInfo).port}/parse`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://fsn1.your-objectstorage.com/test/source",
          keyBase64: Buffer.alloc(32).toString("base64"),
          expectedBytes,
        }),
      },
    );
    return { status: res.status, body: (await res.json()) as ParsedPdf };
  } finally {
    await new Promise<void>((resolve) => parser.close(() => resolve()));
  }
}
/** Reads a baseline or progressive JPEG's dimensions from its first SOF marker. */
function jpegSize(image: Buffer) {
  for (let at = 2; at + 9 < image.length; ) {
    const marker = image[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2)
      return {
        height: image.readUInt16BE(at + 5),
        width: image.readUInt16BE(at + 7),
      };
    at += 2 + image.readUInt16BE(at + 2);
  }
  throw new Error("no SOF marker");
}
it("extracts a real PDF and renders every page, text or not, as a JPEG for the worker", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  for (const fixture of [
    pdfFixture({ pages: 2 }),
    pdfFixture({ text: "" }),
    pdfFixture({ image: true }),
  ]) {
    const parsed = await parseUpload(fixture);
    expect(parsed.status).toBe(200);
    for (const page of parsed.body.pages) {
      const image = Buffer.from(page.imageBase64!, "base64");
      expect(image.subarray(0, 3).toString("hex")).toBe("ffd8ff");
      // The 600 x 200 pt fixture page scales to a 1568 px long edge.
      expect(jpegSize(image)).toEqual({ width: 1568, height: 523 });
    }
  }
  const text = await parseUpload(pdfFixture({ pages: 2 }));
  expect(text.body.pages.map((page) => page.page)).toEqual([1, 2]);
  expect(text.body.pages[1]!.text).toContain("examination");
});
it("renders a 100-page deck within its limits", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  const parsed = await parseUpload(pdfFixture({ pages: 100 }));
  expect(parsed.status).toBe(200);
  expect(parsed.body.pages).toHaveLength(100);
  expect(parsed.body.pages.every((page) => page.imageBase64)).toBe(true);
}, 120_000);
it("parses an image-heavy PDF that decompresses beyond 32 MiB", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  // The openly licensed dhbw-digitaltechnik deck decompresses to 52,352,795 bytes.
  const parsed = await parseUpload(pdfFixture({ inflated: 60 * 1024 * 1024 }));
  expect(parsed.status).toBe(200);
  expect(parsed.body.pages).toHaveLength(1);
}, 60_000);
it("refuses a PDF that decompresses beyond the parser's bound", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  expect(
    (await parseUpload(pdfFixture({ inflated: 513 * 1024 * 1024 }))).status,
  ).toBe(422);
}, 60_000);
it("refuses byte mismatches, malformed PDFs, excessive pages and compressed bombs", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  expect((await parseUpload(pdfFixture(), 10)).status).toBe(413);
  expect((await parseUpload(Buffer.from("%PDF-1.7\ngarbage"))).status).toBe(
    422,
  );
  expect((await parseUpload(pdfFixture({ pages: 101 }))).status).toBe(413);
  expect((await parseUpload(pdfFixture({ bomb: true }))).status).toBe(422);
});

it("parses a PDF that qpdf reads with warnings only, such as a repeated dictionary key", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  const parsed = await parseUpload(pdfFixture({ duplicateKey: true }));
  expect(parsed.status).toBe(200);
  expect(parsed.body.pages[0]!.text).toContain("examination");
});

it("preserves German characters in born-digital pages", async () => {
  const { pdfFixture } = await import("../test/fixtures.js");
  const parsed = await parseUpload(
    pdfFixture({ text: "Pr\\374fung am 12. M\\344rz in Raum H1." }),
  );
  expect(parsed.status).toBe(200);
  expect(parsed.body.pages[0]!.text).toContain("Prüfung am 12. März");
});
