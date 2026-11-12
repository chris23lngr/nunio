// Small PDF fixtures with a real cross-reference table; no uploaded student content.
import { deflateSync } from "node:zlib";
export function pdfFixture({
  pages = 1,
  text = "The examination takes place on March 12 in room H1. Bring your student card and a pen.",
  bomb = false,
  inflated,
  image = false,
  duplicateKey = false,
}: {
  pages?: number;
  text?: string;
  bomb?: boolean;
  inflated?: number;
  image?: boolean;
  /** Repeats a page's /Group key, as LaTeX output often does; qpdf reads it but exits 3 with a warning. */
  duplicateKey?: boolean;
} = {}): Buffer {
  // A bomb decompresses beyond the parser's 512 MiB bound.
  const inflatedBytes = inflated ?? (bomb ? 544 * 1024 * 1024 : 0);
  const objects: Buffer[] = [];
  const add = (text: string | Buffer) => {
    objects.push(Buffer.isBuffer(text) ? text : Buffer.from(text));
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
  );
  add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  // A Flate stream of `inflated` spaces: a few KiB in the file, many MiB once decompressed.
  const content = inflatedBytes
    ? deflateSync(Buffer.alloc(inflatedBytes, 32), { level: 9 })
    : Buffer.from(
        `BT /F1 12 Tf 20 100 Td (${text}) Tj ET${image ? " q 50 0 0 50 500 120 cm /Im1 Do Q" : ""}`,
      );
  add(
    Buffer.concat([
      Buffer.from(
        `<< /Length ${content.length}${inflatedBytes ? " /Filter /FlateDecode" : ""} >>\nstream\n`,
      ),
      content,
      Buffer.from("\nendstream"),
    ]),
  );
  for (let i = 0; i < pages; i++)
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >>${image ? ` /XObject << /Im1 ${5 + pages} 0 R >>` : ""} >> /Contents 4 0 R${duplicateKey ? " /Group << /S /Transparency >> /Group << /S /Transparency >>" : ""} >>`,
    );
  if (image)
    add(
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n0\nendstream",
    );
  let body = Buffer.from("%PDF-1.7\n");
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(body.length);
    body = Buffer.concat([
      body,
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
  }
  const xref = body.length;
  return Buffer.concat([
    body,
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  ]);
}
