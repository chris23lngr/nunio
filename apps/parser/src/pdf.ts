import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ParsedPdf { pages: { page: number; text: string; imageBase64?: string }[] }
export class ParseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const maxPdfBytes = 20 * 1024 * 1024;

// qpdf's decompressed stream output is capped before Poppler reads the document.
// https://qpdf.readthedocs.io/en/stable/cli.html#option-stream-data
export async function parsePdf(bytes: Buffer): Promise<ParsedPdf> {
  if (bytes.length > maxPdfBytes) throw new ParseError(413, "pdf_limit");
  if (!bytes.subarray(0, 8).toString("ascii").match(/^%PDF-1\.[0-9]|^%PDF-2\.0/)) throw new ParseError(422, "invalid_pdf");
  const dir = await mkdtemp(join(tmpdir(), "nunio-pdf-"));
  const path = join(dir, "source.pdf");
  const deadline = Date.now() + 60_000;
  const run = (tool: string, args: string[], maxBuffer = 2 * 1024 * 1024) => new Promise<Buffer>((resolve, reject) => {
    const linux = process.platform === "linux";
    execFile(linux ? "prlimit" : tool, linux
      ? ["--as=402653184", "--cpu=10", "--fsize=33554432", "--nofile=64", "--", tool, ...args] : args,
    { env: { PATH: process.env.PATH, LANG: "C.UTF-8" }, timeout: Math.max(1, Math.min(10_000, deadline - Date.now())),
      maxBuffer, encoding: "buffer" }, (error, stdout) => {
      if (error) {
        const code = "code" in error ? error.code : undefined;
        reject(new ParseError(code === "ENOENT" ? 502 : 422, code === "ENOENT" ? "parser_unavailable" : "invalid_or_excessive_pdf"));
      } else resolve(stdout);
    });
  });
  try {
    await writeFile(path, bytes);
    const pages = Number((await run("qpdf", ["--show-npages", path])).toString().trim());
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > 100) throw new ParseError(413, "page_limit");
    await run("qpdf", [path, "--stream-data=uncompress", "--decode-level=all", "--object-streams=disable", "-"], 32 * 1024 * 1024);
    const texts = (await run("pdftotext", ["-layout", path, "-"])).toString("utf8").split("\f");
    const result: ParsedPdf = { pages: [] };
    let totalBytes = 0;
    for (let page = 1; page <= pages; page++) {
      const text = (texts[page - 1] ?? "").trim();
      const item: ParsedPdf["pages"][number] = { page, text };
      // Only a page without extractable text is scanned; an image on a text page (a logo) is not.
      if (text.length < 80) {
        const prefix = join(dir, "page");
        await run("pdftoppm", ["-f", String(page), "-l", String(page), "-scale-to", "1568", "-singlefile", "-png", path, prefix]);
        const image = await readFile(`${prefix}.png`);
        if (image.length > 2 * 1024 * 1024) throw new ParseError(413, "image_limit");
        item.imageBase64 = image.toString("base64");
      }
      totalBytes += Buffer.byteLength(text) + (item.imageBase64?.length ?? 0);
      if (totalBytes > 16 * 1024 * 1024 || Date.now() > deadline) throw new ParseError(413, "output_limit");
      result.pages.push(item);
    }
    return result;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
