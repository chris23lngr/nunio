# MCP client support in AI SDK 7

Checked: 2026-11-25, for [#257](https://github.com/chris23lngr/nunio/issues/257) (map [#256](https://github.com/chris23lngr/nunio/issues/256)). This is research, not a decision.

Sources:

- **`@ai-sdk/mcp` 2.0.87**, the MCP client of `ai` 7.0.157, read from its published `src/` in `node_modules/.bun/@ai-sdk+mcp@2.0.87…/node_modules/@ai-sdk/mcp/`. Files: `tool/mcp-client.ts`, `tool/mcp-transport.ts`, `tool/mcp-http-transport.ts`, `tool/mcp-sse-transport.ts`, `tool/oauth.ts`, `tool/oauth-types.ts` and `tool/types.ts`.
- **AI SDK docs bundled with `ai` 7.0.157**, in `node_modules/.bun/ai@7.0.157…/node_modules/ai/docs/`: `03-ai-sdk-core/16-mcp-tools.mdx` and `03-agents/06-tool-approvals.mdx`.
- **MCP specification 2026-07-28**, the version the SDK calls `LATEST_PROTOCOL_VERSION`: [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) and [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

Items marked **[unverified]** were inferred from the source code and were not run against a server.

## Packaging

- The MCP client is the separate package `@ai-sdk/mcp`, not `ai` itself. Version 2.0.87 is in the lockfile only as a dependency of `@ai-sdk/react` (`bun.lock`). Neither `packages/chat` nor `apps/worker` lists it. It must be added as a direct dependency, pinned at the version that pairs with `ai` 7.0.157.
- Its entry point is `createMCPClient(config)`, which is stable. `experimental_createMCPClient` is a deprecated alias (`src/index.ts`). One client talks to one server: "it's recommended to create a new client instance per server" (`mcp-client.ts`, class doc).
- Supported protocol versions are `2026-07-28` (stateless), `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05` (`types.ts`, `SUPPORTED_PROTOCOL_VERSIONS`). By default the client first tries `server/discover` (2026-07-28). If that fails with an unrecognised error, it falls back to the legacy `initialize` handshake. A recognised modern error such as `-32022` does not fall back; for those servers set `protocolVersionDiscovery: false` (`mcp-client.ts`, `init` and `tryProtocolDiscovery`, and docs "Initializing an MCP Client").

## Remote transports

| Transport | How | Notes |
| --- | --- | --- |
| Streamable HTTP | `transport: { type: 'http', url, headers?, authProvider?, redirect?, fetch?, initialSessionId?, onSessionIdChange?, onSessionExpired?, terminateSessionOnClose? }` | The docs recommend it for production. Under 2026-07-28 it is stateless: no `Mcp-Session-Id` and no inbound GET stream. With legacy servers it keeps a session id and opens an optional inbound GET SSE stream (`mcp-http-transport.ts`). |
| HTTP+SSE (legacy 2024-11-05) | `transport: { type: 'sse', url, headers?, authProvider?, redirect? }` | Kept for old servers (`mcp-sse-transport.ts`). |
| stdio | `@ai-sdk/mcp/mcp-stdio` | Local only, so not relevant to nunio. |
| Custom | any object implementing `MCPTransport` (`start`, `send`, `close`, `onmessage`/`onerror`/`onclose`) | Also accepts the official MCP SDK's `StreamableHTTPClientTransport` (docs). |

- `redirect` defaults to `'error'`, an SSRF guard (`mcp-transport.ts`).
- `fetch` can be replaced, so nunio can add egress controls or timeouts.
- **Not supported:** "Accepting in-band notifications", "Automatic session persistence for Streamable HTTP transport" and "Resumable SSE streams" (`mcp-client.ts`, class doc). A server notification that arrives on the wire is reported to `onUncaughtError` as "Unsupported message type".

## Authorization (OAuth 2.1)

### What the MCP spec requires of a client (2026-07-28)

- Use **Protected Resource Metadata (RFC 9728)** for authorization server discovery (MUST). Support both RFC 8414 and OIDC discovery (MUST).
- **PKCE**, plus the **`resource` parameter (RFC 8707)** in both the authorization and the token request (MUST), with the server's canonical URI.
- Record the issuer and validate `iss` in the response (RFC 9207) before exchanging the code (MUST).
- **Registration priority** (SHOULD): 1. pre-registered client, 2. **Client ID Metadata Documents (CIMD)** when the authorization server advertises `client_id_metadata_document_supported`, 3. **Dynamic Client Registration**, which is **deprecated as of 2026-07-28** and kept only for compatibility, 4. ask the user.
- Bind pre-registered or DCR credentials to the issuer of the authorization server that issued them (MUST). CIMD client ids are portable across authorization servers.
- Refresh tokens: keep them confidential (MUST). Do not assume one is issued (MUST NOT). Ask for `offline_access` only if the server advertises it (MAY).
- Scopes: use the `scope` from the 401's `WWW-Authenticate`, otherwise `scopes_supported`. On **403 `insufficient_scope`**, do a step-up: re-authorize with the union of the old and the challenged scopes (SHOULD).
- Never pass a token to a server other than the one it was issued for (MUST NOT).

### What `@ai-sdk/mcp` implements

Supply an `authProvider: OAuthClientProvider` on an `http` or `sse` transport (`oauth.ts`):

- **Bearer on every request:** taken from `provider.tokens()` (`mcp-http-transport.ts`, `commonHeaders`).
- **On 401:** it reads `resource_metadata` and `scope` from `WWW-Authenticate` and runs `auth()` once, shared by concurrent 401s. It retries once if the result is `AUTHORIZED`; otherwise it throws `UnauthorizedError` (`send`, `authorizeOnce`).
- **What `auth()` covers:**
  - Protected Resource Metadata discovery, which must be same-origin with the MCP URL.
  - Authorization server metadata discovery with an SSRF guard.
  - The `resource` parameter, PKCE and `state`.
  - Pinning the authorization server and validating `iss` (pass `callbackIssuer`).
  - Refreshing via `refresh_token`.
  - **DCR**, used when `clientInformation()` returns nothing and `saveClientInformation` exists.
  - Recovery from a rejected dynamically registered client, when `isClientInformationDynamicallyRegistered()` returns true.
  - Concurrency-safe invalidation of rotated refresh tokens through `invalidateCredentials('tokens', { tokens })`, which needs an atomic compare-and-delete in storage (docs, "Shared OAuth Credential Storage").
- **Pre-registered clients** are supported. A confidential client must have its `issuer` set, or `auth()` refuses (docs, "OAuth Authorization Server Validation"). `validateAuthorizationServerURL` lets the app allowlist authorization server origins.
- **Redirect flow:** `auth()` calls `provider.redirectToAuthorization(url)` and returns `'REDIRECT'`. The app finishes the flow on its callback by calling `auth(provider, { serverUrl, authorizationCode, callbackState, callbackIssuer })`.
- **Refresh is reactive only.** `expires_in` is parsed but expiry is never tracked. The stored access token is sent until the server answers 401, and only then does a refresh run. Calling `auth(provider, { serverUrl })` while a refresh token is stored refreshes ahead of time, so nunio can refresh proactively.
- **Not implemented:**
  - **CIMD.** The `client_id_metadata_document_supported` field is parsed but never used (`oauth-types.ts`; no other reference). **[unverified]** workaround: return `{ client_id: 'https://<nunio>/oauth/client.json' }` without a secret from `clientInformation()`. The SDK then treats it as a pre-registered public client, and the issuer binding is enforced only for clients with secrets.
  - **403 `insufficient_scope` step-up.** `mcp-http-transport.ts` handles no 403, so it surfaces as an HTTP error.
  - `client_credentials`.

## Tool annotations

- The spec says clients "**MUST** consider tool annotations to be untrusted unless they come from trusted servers" (Tools, "Data Types"). It also recommends a human in the loop who can deny invocations and see the inputs.
- The SDK parses `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. It exposes them on each tool's `metadata.annotations` and on the call's `toolMetadata.annotations` as `McpProviderMetadata` (`mcp-client.ts`, `toolsFromDefinitions`). Per the docs, "the MCP client does not turn them into an approval policy automatically."
- This matches the map's decision that nunio's catalog classifies tools. The hints can at most seed that classification when a curator adds an Integration.

## Listing tools and detecting changes

- `listTools({ params: { cursor } })` returns one page of the raw `ListToolsResult`. `tools()` follows every `nextCursor` and returns an AI SDK `ToolSet`. `toolsFromDefinitions(listToolsResult)` builds the same `ToolSet` from stored definitions **without a network call** (`mcp-client.ts`).
- With `tools({ schemas: { name: { inputSchema, outputSchema? } } })`, only the listed tools are exposed, with schemas nunio controls.
- **Change notifications are not supported.** In 2026-07-28, `notifications/tools/list_changed` is delivered only on a `subscriptions/listen` stream. The SDK opens no such stream and rejects in-band notifications.
- 2026-07-28 adds `ttlMs` and `cacheScope` to list results. The SDK does not type them for `tools/list`, but its schemas are loose, so they pass through **[unverified at runtime]**.
- **Drift detection:** `ai` exports `fingerprintTools(toolSet)` and `detectToolDrift(current, baseline)`. They hash each tool's description, resolved input schema and title, and report `added`, `changed` and `removed`. Storing the baseline and deciding what to do with drift is left to the app (docs, "Detecting tool-definition drift"). They cannot detect a change in behaviour behind unchanged definitions.

## Intercepting calls (the approval gate)

nunio has three options. It already uses the first two.

1. **No `execute`.** The `ToolSet` from `tools()` wraps `callTool` in `execute`. nunio can instead build its own tools from `listTools()` definitions with `dynamicTool`/`tool` and **no `execute`**. The model's call then comes back as a tool call, and nunio's gate decides it and calls `client.callTool({ name, arguments })` itself. This is how the Agent loop already treats Actions (`packages/ai/src/agent.ts`: "Action tools, which have no `execute`"). It suits the worker, where the gate performs after the step.
2. **`toolApproval`.** For `streamText`/`generateText`/`ToolLoopAgent`, `toolApproval` maps a tool name, or every call through one function, to `'not-applicable' | 'approved' | 'denied' | 'user-approval'` before `execute` runs (docs, "Tool Approvals"). Chat already uses this for proposals (`packages/chat/src/chats.ts`), with authority from the gate, not the SDK (ADR-0019).
3. **Wrap `execute`.** nunio's code runs first and decides whether to call through.

- **Retries:** `maxRetries` on the client applies only to `tools/call` and defaults to `0`. The docs warn that retrying non-idempotent tools duplicates effects. Keep it at 0 for write tools.
- **Not supported:**
  - **Multi-round-trip `input_required` results (2026-07-28).** The SDK throws "multi round-trip requests are not supported yet" (`mcp-client.ts`, response handling).
  - **Elicitation** is limited to legacy `elicitation/create` through `onElicitationRequest`, and only if advertised. Sampling and roots are rejected.

## Calling MCP tools from a Temporal activity

The SDK has no Temporal-specific support. What the source implies:

- **Client lifetime.** A client is a live object, not serializable. The worker should create it inside the activity and `close()` it in `finally`. It must not travel through workflow state.
  - Against a 2026-07-28 server, creating one costs a single `server/discover` request.
  - Against a legacy server, it costs `initialize` plus `notifications/initialized`. The transport may also open a GET SSE stream that `close()` ends.
  - A legacy session can be resumed with `initialSessionId`, `initialInitializeResult` and `terminateSessionOnClose: false`. Not needed for one call.
  - Passing `initialInitializeResult` skips discovery but sets the client's protocol era to `'legacy'` (`applyInitializeResult`). Don't use it with 2026-07-28 servers **[observed in source, not tested]**.
- **Tool definitions** can be fetched once per Connection, stored as JSON and turned back into tools with `toolsFromDefinitions`. A model step then needs no MCP traffic until a call is performed.
- **OAuth inside an activity.**
  - The `OAuthClientProvider` must read and write tokens in Postgres, because activities run on any worker and may run concurrently.
  - Implement the `invalidateCredentials` compare-and-delete.
  - `redirectToAuthorization` must not try to redirect. It should mark the Connection as needing reconnection. The call then throws `UnauthorizedError`, which should be a non-retryable failure.
- **Cancellation and timeouts.** `callTool` takes `options.signal` and `timeout`/`maxTotalTimeout`, and `createMCPClient` takes `initializationOptions`. Wire them to `Context.current().cancellationSignal` and the activity's start-to-close timeout.
- **Ambiguous writes.** A timeout or a dropped connection on `tools/call` cannot tell whether the remote write happened. The MCP spec gives no idempotency key. This is the "Unconfirmed" case on the map: never retry a write automatically. Reads can be retried.

## An in-process tool set behind the same interface

Yes, through either of two seams:

- **The `ToolSet` level (simplest).** `mcpClient.tools()` returns a plain AI SDK `ToolSet`. Email tools written with `tool()`/`dynamicTool()` are the same type, so the model loop and `toolApproval` cannot tell them apart. For the same gate path, nunio defines Email tools without `execute`, plus its own `call(name, args)`.
- **The `MCPClient` level.** `createMCPClient({ transport })` accepts any custom `MCPTransport`. An in-memory transport that answers `initialize`, `tools/list` and `tools/call` JSON-RPC in-process yields a real `MCPClient` (`listTools`/`callTool`/`tools`). The SDK's own test `MockMCPTransport` (`mock-mcp-transport.ts`, not exported) does exactly that. nunio would hand-write the JSON-RPC handling. The official `@modelcontextprotocol/sdk` has a server and in-memory transport for this, but it is not installed here **[unverified]**.

Recommendation for the spec: put a narrow nunio interface in `packages/integrations`. It would have `listTools()`, returning definitions nunio can store and fingerprint, and `callTool(name, args, { signal })`. Implement it once over `MCPClient` and once directly over IMAP/SMTP. That avoids JSON-RPC for Email and keeps one gate path. The `MCPClient`-level seam stays available if a uniform MCP wire format is wanted later.

## What nunio must build itself

1. **Connection credential store.** Store client information, tokens, the authorization server pin, the PKCE verifier and `state` per Connection, encrypted at rest (ADR-0007). Implement `OAuthClientProvider` over it, with an atomic compare-and-delete in `invalidateCredentials`.
2. **The OAuth connect flow in `apps/api`.**
   - Start: call `auth()`, which returns `REDIRECT`, and capture the URL.
   - Callback: call `auth()` with `code`, `state` and `iss`.
   - Allowlist each catalog entry's authorization server origins with `validateAuthorizationServerURL`.
   - Decide per catalog entry: pre-registered client, CIMD or DCR. **CIMD is not built in**, so either host a client metadata document and pass its URL as a pre-registered public `client_id` **[unverified]**, or rely on DCR, which the spec now deprecates.
3. **Refresh policy.** Proactive refresh through `auth()` if wanted, because the SDK only refreshes after a 401. Map "refresh failed / `REDIRECT` / `UnauthorizedError`" to the Connection needing reconnection.
4. **403 `insufficient_scope` handling.** Step up or mark the Connection as needing reconnection. The SDK does not handle it.
5. **Tool catalog and classification.**
   - Fetch and store each Integration's tool definitions.
   - Classify each tool as read, write or never grantable, in nunio's catalog rather than from annotations.
   - Fingerprint the definitions with `fingerprintTools` and block or re-review on `detectToolDrift`.
   - Refresh on a schedule or on `ttlMs`, since list-changed notifications are unsupported.
6. **Gate integration.** Expose write tools without `execute`, or behind `toolApproval`. Route each call through the gate (ADR-0010) with its exact arguments. Perform it with `callTool`, with `maxRetries: 0`, and record Unconfirmed on timeout.
7. **Activity wrapper.** Create the client per activity: credentials from Postgres, `signal` and timeouts wired to the activity, `close()` in `finally`, OAuth failures non-retryable.
8. **Tool name namespacing** across Connections, for example `<integration>.<tool>`. The spec says aggregating clients SHOULD disambiguate.
9. **Result handling.** Limit the size of tool results before they reach the model. The SDK passes `content` through, converting text and images (`mcpToModelOutput`).
10. **Email tool layer** behind the same nunio interface, over IMAP/SMTP.
11. **Unsupported server features.** Decide how to treat servers that need `input_required` (MRTR) or elicitation. These are unsupported or partial in the SDK, so a call to one fails.

## Not verified

- Behaviour against a real third-party remote MCP server; nothing was run.
- The CIMD workaround (a URL `client_id` passed as a pre-registered public client).
- Whether `ttlMs`/`cacheScope` survive parsing in `tools/list` results at runtime.
- How `@modelcontextprotocol/sdk` in-memory transports work with `createMCPClient`.
- Which catalog candidates speak 2026-07-28 rather than a legacy version, and which support CIMD, DCR or pre-registration.
