# Temporal Cloud for durable execution

Background work runs on Temporal Cloud in AWS `eu-central-1` (Developer plan). The worker runs on Node in a Render background worker in Frankfurt, because Vercel Functions cannot host a long-polling worker. Payloads are encrypted by our own Payload Codec, so Temporal stores only ciphertext and opaque IDs. History retention is 7 days, and staging and production use separate namespaces. We chose Temporal over Vercel Workflows because the latter keeps approval-hook records in `iad1` by default, cannot delete a finished run's data early, and offers only a non-production-ready self-hosting exit. Each of those conflicts with the brief's EU residency, deletion, and possible-self-hosting requirements. We chose Temporal Cloud over self-hosting to avoid running four Temporal services plus persistence as a solo founder; self-hosting remains an exit without workflow code changes.

Workflow code changes use `patched()` plus mandatory replay tests in CI, not Worker Versioning. Render replaces worker instances on deploy, so keeping old builds alive until their Runs finish would mean running several worker services side by side. Bounded Approval expiry (ADR-0006) gives a known window after which old patch branches can be removed. Evidence: [durable-ai.md](../research/durable-ai.md), [runtime-hosting.md](../research/runtime-hosting.md).

## Considered Options

- **Vercel Workflows**: no worker host, all apps on Vercel; rejected for residency, deletion, and lock-in.
- **BullMQ**: simpler, but approval waits, timers, and cancellation would be hand-built.
- **Self-hosted Temporal**: kept as the exit path.
