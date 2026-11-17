import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { localPdf } from "./local.js";

const sha256 = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

it("finds a document by its SHA-256 whatever its file name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nunio-local-"));
  await writeFile(join(dir, "01 Einführung (1).pdf"), "first");
  await writeFile(join(dir, "02 Prognose.pdf"), "second");

  expect(String(await localPdf(dir, sha256("second")))).toBe("second");
});

it("names the missing hash and folder when no file matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nunio-local-"));
  await writeFile(join(dir, "changed.pdf"), "edited since labelling");

  await expect(localPdf(dir, sha256("original"))).rejects.toThrow(
    `${sha256("original")} in ${dir}`,
  );
});
