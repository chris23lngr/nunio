import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** A labelled Course document from the founder's local folder (EVAL_LOCAL_PDFS), found by content, never by name. */
export async function localPdf(dir: string, sha256: string) {
  for (const name of await readdir(dir)) {
    if (!name.toLowerCase().endsWith(".pdf")) continue;
    const bytes = await readFile(join(dir, name));
    if (createHash("sha256").update(bytes).digest("hex") === sha256)
      return bytes;
  }
  throw new Error(`No PDF with SHA-256 ${sha256} in ${dir}`);
}
