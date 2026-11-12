# Document parsing in a separate service without secrets

Uploaded documents are parsed by a dedicated `apps/parser` service, a Render private service in Frankfurt that holds no secrets. The worker sends it a short-lived presigned URL and the single file's SSE-C key, and receives structured text back. The parser enforces size, page, decompression, and time limits. The brief requires parsing in an isolated environment without unnecessary network access or credentials, and the worker holds database, Temporal, Connection, and master-key secrets. Parsing untrusted files inside the worker, even in a subprocess with an empty environment, would still share its container, file system, and network.

This makes parser a fourth deployable app, accepted as the cost of keeping a compromised parser from reaching anything beyond the one file it was given.

## Amendment (2026-11-12): Poppler reads qpdf's decoded rewrite

The decompression bound holds only if it measures what Poppler renders. qpdf and Poppler resolve some malformed PDFs differently, such as a repeated `/Filter` key or a predictor qpdf silently leaves undecoded, so measuring the upload with qpdf and rendering it with Poppler left a way past the bound. qpdf now rewrites the upload fully decoded into a file capped at 512 MiB, and Poppler reads only that file, so qpdf's warnings alone no longer refuse an upload. A stream that still carries a filter after the rewrite was not decoded and refuses the upload. The exceptions are image codecs qpdf never decodes (JBIG2, JPX, CCITT), and qpdf leaves inline images inside content streams encoded too. Poppler decodes these as before, bounded only by the parser's memory and CPU limits. The rewrite needs up to 512 MiB of temporary disk per parse.
