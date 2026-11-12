import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export interface ParsedPdf {
  pages: { page: number; text: string; imageBase64?: string }[];
}
export class ParseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const maxPdfBytes = 20 * 1024 * 1024;
/** 100 rendered pages at up to ~400 KB of JPEG each, base64-encoded, plus their text. */
const maxOutputBytes = 64 * 1024 * 1024;
/**
 * qpdf's fully decoded output for a 20 MiB PDF. `--decode-level=all` expands JPEG images to raw pixels: the
 * eval's dhbw-digitaltechnik slides (pages 1-35, 2.2 MB) decode to 52,352,795 bytes, about 24:1, so a 20 MiB
 * deck like it reaches about 480 MiB. Flate bombs expand up to about 1000:1 and stay refused.
 */
const maxDecompressedBytes = 512 * 1024 * 1024;
/**
 * Image codecs qpdf never decodes. Poppler decodes them, bounded only by `prlimit` (ADR-0009). A stream that
 * still carries any other filter after qpdf's full decode is one qpdf could not decode, so it went unmeasured.
 */
const imageFilters = new Set(["/JBIG2Decode", "/JPXDecode", "/CCITTFaxDecode"]);

// qpdf rewrites the upload fully decoded, capped in size, and Poppler reads only that rewrite, so the
// bound covers the same dictionaries and streams Poppler renders.
// https://qpdf.readthedocs.io/en/stable/cli.html#option-stream-data
export async function parsePdf(bytes: Buffer): Promise<ParsedPdf> {
  if (bytes.length > maxPdfBytes) throw new ParseError(413, "pdf_limit");
  if (
    !bytes
      .subarray(0, 8)
      .toString("ascii")
      .match(/^%PDF-1\.[0-9]|^%PDF-2\.0/)
  )
    throw new ParseError(422, "invalid_pdf");
  const dir = await mkdtemp(join(tmpdir(), "nunio-pdf-"));
  const path = join(dir, "source.pdf");
  const decoded = join(dir, "decoded.pdf");
  // A 100-page deck renders one page per Poppler call, so the budget covers every page, not just scans.
  const deadline = Date.now() + 240_000;
  const linux = process.platform === "linux";
  const command = (tool: string, args: string[]) =>
    [
      linux ? "prlimit" : tool,
      linux
        ? [
            "--as=402653184",
            "--cpu=30",
            "--fsize=33554432",
            "--nofile=64",
            "--",
            tool,
            ...args,
          ]
        : args,
    ] as const;
  const options = () => ({
    env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
    timeout: Math.max(1, Math.min(30_000, deadline - Date.now())),
  });
  const refusal = (code: unknown) =>
    new ParseError(
      code === "ENOENT" ? 502 : 422,
      code === "ENOENT" ? "parser_unavailable" : "invalid_or_excessive_pdf",
    );
  const run = (tool: string, args: string[], maxBuffer = 2 * 1024 * 1024) =>
    new Promise<Buffer>((resolve, reject) => {
      execFile(
        ...command(tool, args),
        { ...options(), maxBuffer, encoding: "buffer" },
        (error, stdout) => {
          if (error) reject(refusal("code" in error ? error.code : undefined));
          else resolve(stdout);
        },
      );
    });
  /** Writes a tool's output to `target` and kills it past `limit`, without holding the output in memory. */
  const measure = (
    tool: string,
    args: string[],
    limit: number,
    target: string,
  ) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(...command(tool, args), {
        ...options(),
        stdio: ["ignore", "pipe", "ignore"],
      });
      let bytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limit) child.kill("SIGKILL");
      });
      const written = pipeline(child.stdout, createWriteStream(target)).then(
        () => true,
        () => false,
      );
      child.on("error", (error) =>
        reject(refusal("code" in error ? error.code : undefined)),
      );
      // qpdf exits 3 when it read the upload with warnings. Poppler reads only what qpdf wrote.
      child.on("close", (code) =>
        written.then((ok) =>
          ok && (code === 0 || code === 3) && bytes <= limit
            ? resolve()
            : reject(refusal(code)),
        ),
      );
    });
  try {
    await writeFile(path, bytes);
    const pages = Number(
      (await run("qpdf", ["--show-npages", path])).toString().trim(),
    );
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > 100)
      throw new ParseError(413, "page_limit");
    await measure(
      "qpdf",
      [
        path,
        "--stream-data=uncompress",
        "--decode-level=all",
        "--object-streams=disable",
        "-",
      ],
      maxDecompressedBytes,
      decoded,
    );
    // A 332-page deck lists its objects in about 4.6 MB of JSON.
    const objects: Record<
      string,
      { stream?: { dict: Record<string, unknown> } }
    > = JSON.parse(
      (
        await run(
          "qpdf",
          ["--json=2", "--json-key=qpdf", "--json-stream-data=none", decoded],
          32 * 1024 * 1024,
        )
      ).toString("utf8"),
    ).qpdf[1];
    // Poppler also reads a filter from /F, the abbreviation inline images use; qpdf reads it as a file.
    for (const object of Object.values(objects))
      for (const key of ["/Filter", "/F"]) {
        const filter = object.stream?.dict[key];
        if (
          filter !== undefined &&
          ![filter].flat().every((name) => imageFilters.has(name as string))
        )
          throw new ParseError(422, "invalid_or_excessive_pdf");
      }
    const texts = (await run("pdftotext", ["-layout", decoded, "-"]))
      .toString("utf8")
      .split("\f");
    const result: ParsedPdf = { pages: [] };
    let totalBytes = 0;
    for (let page = 1; page <= pages; page++) {
      const text = (texts[page - 1] ?? "").trim();
      const item: ParsedPdf["pages"][number] = { page, text };
      // Every page is rendered: slides carry most of their content in figures next to a short text layer.
      const prefix = join(dir, "page");
      await run("pdftoppm", [
        "-f",
        String(page),
        "-l",
        String(page),
        "-scale-to",
        "1568",
        "-singlefile",
        "-jpeg",
        "-jpegopt",
        "quality=80",
        decoded,
        prefix,
      ]);
      const image = await readFile(`${prefix}.jpg`);
      if (image.length > 2 * 1024 * 1024)
        throw new ParseError(413, "image_limit");
      item.imageBase64 = image.toString("base64");
      totalBytes += Buffer.byteLength(text) + item.imageBase64.length;
      if (totalBytes > maxOutputBytes || Date.now() > deadline)
        throw new ParseError(413, "output_limit");
      result.pages.push(item);
    }
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
