// Build first: docker build -f apps/parser/Dockerfile -t nunio-parser-phase5 .
// Run: node apps/parser/scripts/check-container.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pdfFixture } from "../test/fixtures.ts";

const image = process.argv[2] ?? "nunio-parser-phase5";
for (const name of ["DATABASE_URL", "SOURCE_MASTER_KEYS"]) {
  const secret = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--memory=512m",
      "-e",
      `${name}=test-secret`,
      image,
    ],
    { encoding: "utf8" },
  );
  assert.equal(secret.status, 1);
  assert.match(secret.stderr, /refusing to start with secrets/);
  assert.ok(!secret.stderr.includes("test-secret"));
}
for (const [bytes, expected] of [
  [pdfFixture(), 200],
  [pdfFixture({ text: "" }), 200],
  [pdfFixture({ pages: 101 }), 413],
  [pdfFixture({ bomb: true }), 422],
  [Buffer.from("%PDF-1.7\ngarbage"), 422],
] as const) {
  const script = `
    import { createParserServer } from './apps/parser/dist/server.js';
    const bytes=Buffer.from('${bytes.toString("base64")}','base64');
    const server=createParserServer({quarantineBucket:'test',fetch:async()=>new Response(bytes)});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/parse',{method:'POST',body:JSON.stringify({url:'https://fsn1.your-objectstorage.com/test/source',keyBase64:Buffer.alloc(32).toString('base64'),expectedBytes:bytes.length})});
    console.log(res.status);server.close();
  `;
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--memory=512m",
      "-i",
      "--entrypoint=node",
      image,
      "--input-type=module",
    ],
    { input: script, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number(result.stdout.trim()), expected);
}
console.log(
  "Container: secret rejection, real PDF, rendered scan, page limit, decompression bomb and malformed PDF passed under 512 MiB with no network.",
);
