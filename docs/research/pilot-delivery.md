# Pilot delivery evidence

Research date: 2026-10-29. Facts below come from primary documentation; implementation choices are proposals. No external services were provisioned or tested.

## Flashcard export

Source: [Anki manual — Text Files](https://docs.ankiweb.net/manual/importing/text-files), sections Text Files, Duplicates and Updating, and File Headers.

Verified: Anki imports UTF-8 delimited text and allows field mapping. Separator/newline/quote escaping matters. Default duplicate detection uses the first field and note type; a re-import can update existing notes.

Copy location: the manual's multiline/quote examples and file-header examples. Proposed pilot: downloadable, plain-text TSV with an explicit field mapping and import preview; test German characters, embedded delimiters, multiline answers and re-import behavior in the supported Anki version. This supports export, not a promise of remote Anki account synchronization. Decide stable identifiers and note type before offering updates. Preserve source provenance in nunio even where the target note format cannot carry it.

## Browser push

Source: [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), Push concepts and usage, Interfaces, Examples, Browser compatibility.

Verified APIs: `PushManager.subscribe()`, `PushSubscription`, and `ServiceWorkerRegistration.showNotification()`. A service worker receives push events. Subscription endpoints are sensitive capability URLs.

Copy location: linked examples under Examples and the API reference links. Proposed pilot: opt-in subscriptions behind authenticated, CSRF-protected routes; generic notification payloads; check support on actual pilot devices. In-app inbox is the source of truth; push delivery must not mark an obligation completed. Permission denied or unavailable must leave the product usable. Verify device/browser setup requirements before promising mobile reachability.

## CI security

Source: [GitHub Actions — Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use), Writing workflows, Mitigating the risks of untrusted code checkout, Using third-party actions.

Verified guidance: minimize `GITHUB_TOKEN` permissions; protect secrets; keep untrusted values out of executable script interpolation; use full commit SHA pins for actions.

Copy location: the intermediate-environment-variable example and third-party action pinning section. Proposed implementation: `permissions: contents: read` by default, per-job elevation only where necessary, no production secrets in pull-request jobs, immutable build artifacts, protected deployment jobs, dependency and secret checks. Check repository-plan feature availability before relying on approval controls. Deployment provider and repository host account are not yet configured.

## Database isolation

Source: [PostgreSQL — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), introductory policy semantics and accounts examples.

Verified: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` activates policies; no policy means default denial for normal roles. Owners typically bypass policies; superusers and `BYPASSRLS` roles bypass them. `FORCE ROW LEVEL SECURITY` changes owner behavior. `USING` and `WITH CHECK` govern row visibility and writes.

Copy location: accounts policy example. Proposed implementation: app-level tenant authorization plus database policies tested under actual runtime roles, a separate migration role, and transaction-scoped identity with connection-pool leakage tests. RLS is defense in depth, not a substitute for tool permissions or scoped retrieval.

## Confidence and gaps

High confidence in documented APIs and semantics, not yet verified against installed packages or pilot devices. No pilot tools, university credentials, notification provider, deployment provider, or accepted version matrix exists yet. These are evidence gates in the implementation plan, not implicit support commitments.
