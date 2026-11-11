# Web app foundation

The web app owns browser server-state caching. `@nunio/api-client` remains a
framework-independent OpenAPI transport; Better Auth owns authentication.
Server Components continue to verify sessions before rendering protected pages.

## Placement and naming

- `app/`: Next.js routes, layouts, and provider composition. Route files compose
  features; they do not own browser fetching or mutation state.
- `features/<feature>/api/`: typed query and mutation options, query keys, and
  feature-specific refresh rules.
- `features/<feature>/<feature>-screen.tsx`: orchestration of queries, mutations,
  navigation, and screen state.
- `features/<feature>/components/`: display components receiving data and callbacks
  through props. Local interaction state is fine; these do not fetch API data.
- `lib/`: app-wide infrastructure, including API adaptation and QueryClient setup.
- `packages/ui`: shared visual primitives and styles.

Use kebab-case filenames, PascalCase component names, and `useSomething` for
hooks. Use the `Screen` suffix for screen-level orchestration. Extract a hook or
component when it clarifies responsibility; do not require a paired container,
view, and hook for every component. Import feature files directly rather than
creating barrel files. Keep API response types derived from the generated schema.

Sources is the first migrated feature. Review remains in its existing route
until the completed Phase 6 changes are incorporated. Existing account/auth
components can stay colocated until a feature change warrants moving them.

## Server-state ownership

Use React Query for interactive API reads and mutations. Do not mirror query
results, loading status, or mutation status in React state. Local form values
and interaction state remain local. Display components receive props and callbacks.
The Chat screen is the one exception: `useChat` owns the open Chat's messages and
syncs each refetch ([ADR-0016](../../docs/adr/0016-usechat-owns-the-open-chat.md)).

The initial implementation fetches in the browser. Server prefetching/hydration
is deferred until measurements justify it. Do not render independently cached
server and browser copies of the same list or aggregate.

The shared baseline is 30 seconds of freshness, five minutes of inactive cache
retention (TanStack's default), refresh on stale mount/focus/reconnect, one retry
for reads, and no automatic mutation retries. Session-expiry responses are never
retried. Caches are memory-only. Session expiry clears them and returns to sign-in.
A Better Auth session boundary detects account changes on focus/reconnect and
through its cross-tab notifications. Authentication transitions clear caches and
use Next.js router navigation plus refreshes to update the server-rendered
identity and route cache. Account deletion and signing out everywhere use the
same policy. The browser shares one Better Auth client per API origin so its
session subscribers see sign-in and sign-out immediately.

Sources polls every five seconds only while ingestion or extraction is active,
with no polling in a hidden tab. An abandoned upload is not active processing.
Upload completion or failure refreshes Sources, since a failed upload can leave
a Source record to clean up. Successful deletion removes the confirmed-deleted
Source and refreshes the remaining list. Read again refreshes Sources after the
request settles so extraction polling follows the server state. Never present an unconfirmed mutation
as saved. Future Review mutations must invalidate their affected Course/Review
queries; Source deletion must also invalidate Review once it uses Query.

## Forms

Use `useAppForm` from `@/lib/form` for client form state. It binds text fields
and submit buttons to TanStack Form with typed field names and values. No global
provider is needed. Keep API calls in the owning feature or existing auth handler;
TanStack Form owns input values, validation and submission state, while Query
continues to own server state.

```tsx
const form = useAppForm({
  defaultValues: { title: "" },
  onSubmit: async ({ value }) => { await save(value); },
});

return (
  <form onSubmit={event => { event.preventDefault(); void form.handleSubmit(); }}>
    <form.AppField name="title" validators={{
      onChange: ({ value }) => value.trim() ? undefined : "Enter a title.",
    }}>
      {field => <field.TextField label="Title" required />}
    </form.AppField>
    <form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>
  </form>
);
```

Text fields preserve native input attributes and connect touched-field errors to
the input for assistive technology. Validators used with `TextField` return strings.
Submit buttons subscribe to submission state to prevent duplicate requests; await
asynchronous work in `onSubmit`. Use `form.Field` for custom controls.

Sign-in, password reset and account deletion use this pattern. Sources and Review
retain their existing handlers until their next feature migration.

Reference: [TanStack Form composition](https://tanstack.com/form/latest/docs/framework/react/guides/form-composition).

## Verification

From the repository root:

```sh
bunx turbo run test typecheck lint --filter=@nunio/web
bunx turbo run build --filter=@nunio/e2e^...
bun run --cwd apps/e2e test:e2e
bun run --cwd apps/web test:browser
```

For a manual sidebar preview, run these commands in separate terminals from the repository root:

```sh
node apps/web/test/browser/api-server.ts
API_ORIGIN=http://localhost:3101 bun run --cwd apps/web dev --port 3100
```

Open <http://localhost:3101/preview> to set the fixture session cookie and enter the app. This uses a test identity; real sign-out requires the normal API.

The web browser suite starts an isolated Next.js app and a controlled authentication HTTP fixture on ports 3100/3101. It checks the sidebar header on desktop and mobile without a database or live account.

Feature tests exercise screens with the real Query provider and typed transport,
controlling responses through an isolated local Node HTTP server. Browser tests
exercise the running Next.js app and existing Better Auth setup. Assert user-visible results
and HTTP behavior, not internal hooks or query-key layouts. Work one failing
behavior through to a passing implementation before starting the next.

Reference: [TanStack defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
and [server rendering guidance](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr).
