# Document parsing in a separate service without secrets

Uploaded documents are parsed by a dedicated `apps/parser` service, a Render private service in Frankfurt that holds no secrets. The worker sends it a short-lived presigned URL and the single file's SSE-C key, and receives structured text back. The parser enforces size, page, decompression, and time limits. The brief requires parsing in an isolated environment without unnecessary network access or credentials, and the worker holds database, Temporal, Connection, and master-key secrets. Parsing untrusted files inside the worker, even in a subprocess with an empty environment, would still share its container, file system, and network.

This makes parser a fourth deployable app, accepted as the cost of keeping a compromised parser from reaching anything beyond the one file it was given.
