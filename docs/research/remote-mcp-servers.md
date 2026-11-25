# Official remote MCP servers for a first catalog

Checked: 2026-11-25. Question: [#258](https://github.com/chris23lngr/nunio/issues/258), on map [#256](https://github.com/chris23lngr/nunio/issues/256) (Integrations v1). This is research, not an accepted decision. It records what vendors document and what their servers' public OAuth metadata returned on the check date. No tool was called with a token, so a server's live `tools/list` (and its annotations) was seen only where the vendor publishes it.

Inputs: [ADR-0008](../adr/0008-meaning-of-eu-hosting.md), [ADR-0010](../adr/0010-approval-requires-confirming-the-exact-action.md), `GLOSSARY.md` (Integration, Connection, Disconnect, Action, Approval). Primary sources: the MCP specification, revision [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28); each vendor's MCP documentation; and the unauthenticated discovery documents (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) fetched with `curl` from each server.

## Finding and recommendation

Six vendors run an official remote MCP server that a student could plausibly use: **Notion, Google Workspace (Calendar, Drive and others), Linear, GitHub, Atlassian** and **Microsoft (Work IQ)**. No official OneNote MCP server exists. They fall into two auth shapes, and the Connection model has to hold both:

1. **Open registration (Notion, Linear, Atlassian).** The MCP server is its own OAuth authorization server. nunio needs no prior agreement with the vendor. It uses a Client ID Metadata Document (CIMD), or Dynamic Client Registration (DCR) as a fallback.
2. **Pre-registered app (Google, GitHub, Microsoft).** The authorization server is the vendor's normal OAuth (Google, `github.com/login/oauth`, Entra ID). nunio must register an app in the vendor's console, and keep a client ID and secret per Integration. Google adds app verification for some scopes.

**Recommendation: paper-check the Connection model against Notion and Google Calendar.**

- **Notion** is the clean case of shape 1: CIMD plus DCR, one `default` scope, rotating refresh tokens, `destructiveHint` on its delete tools, and rate limits returned as tool errors. Students use it widely, and Free and Plus plans can connect by OAuth.
- **Google Calendar** is the hard case of shape 2: a pre-registered client marked "for an AI-powered agent", granular read and write scopes, 1-hour access tokens, refresh-token expiry rules, per-project quotas and billing, annotations on every tool, and a status Google's own pages disagree on (GA or Developer Preview). It is also the glossary's own example of an Integration.

If the model handles these two, GitHub and Linear fit without new concepts. Atlassian and Microsoft add per-organization admin gates (a domain allowlist, a tenant policy and licence), so they fit students badly for v1. They show one more thing the model must allow: **generic gateway tools** (`executeWrite`, Work IQ's runtime-discovered tools), where a tool name alone does not say whether a call writes.

## What the MCP specification requires (2026-07-28)

Sources: [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [Schema: ToolAnnotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations).

- **Client registration order.** Clients SHOULD use, in order: (1) pre-registered client information, (2) CIMD when the authorization server advertises `client_id_metadata_document_supported`, (3) DCR when it advertises a `registration_endpoint`, (4) asking the user. **DCR is deprecated as of 2026-07-28.** It stays in the spec for at least twelve months, for authorization servers that lack CIMD.
- **Issuer binding.** Pre-registered or DCR credentials MUST be bound to the issuing authorization server's `issuer`. A client MUST re-register if the protected resource metadata points to a different server. CIMD client IDs are portable across authorization servers.
- **Every request** MUST carry `resource` (RFC 8707, the server's canonical URI) and use PKCE. The client MUST record the expected issuer and validate `iss` in the authorization response (RFC 9207). Tokens go only in the `Authorization: Bearer` header and MUST NOT be passed through to other resources.
- **Scopes.** The client should start from the `scope` in the 401 challenge, otherwise from `scopes_supported`. At runtime a server SHOULD answer `403 insufficient_scope` with the scopes needed. A client acting for a user SHOULD then re-authorize (step-up) with the **union** of the old and new scopes.
- **Refresh tokens.** Clients MUST keep them confidential and MUST NOT assume one is issued. They MAY ask for `offline_access` when the authorization server lists it.
- **Tool annotations.** `readOnlyHint` (default `false`), `destructiveHint` (default `true`, meaningful only when not read-only), `idempotentHint` (default `false`), `openWorldHint` (default `true`). The spec says: "clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers". It also says clients "should never make tool use decisions based on `ToolAnnotations` received from untrusted servers". A tool without annotations therefore counts as a possibly destructive write.
- **Tool list.** `tools/list` MAY vary by the authorization presented, such as granted scopes. It carries `ttlMs` and `cacheScope` for caching, and servers SHOULD order tools deterministically. Clients SHOULD show tool inputs to the user before calling, and SHOULD implement timeouts.

This fits the map's settled rule that "nunio's catalog classifies tools, not the server's own hints". The hints are still a useful default when nunio first classifies a new tool.

## Per server

### Notion

Sources: [Connect to Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp), [Build an MCP client for Notion](https://developers.notion.com/guides/mcp/build-mcp-client), [Tool FAQs (full tool list)](https://developers.notion.com/guides/mcp/tools-faqs), [Pages reference](https://developers.notion.com/guides/mcp/tools-pages-reference), [Databases reference](https://developers.notion.com/guides/mcp/tools-databases-reference), [MCP rate limits](https://developers.notion.com/guides/mcp/rate-limits), [Request limits](https://developers.notion.com/reference/request-limits), [Help: Notion MCP](https://www.notion.com/help/notion-mcp), [Help: Data residency](https://www.notion.com/help/data-residency), discovery documents on `mcp.notion.com`.

- **URL:** `https://mcp.notion.com/mcp` (Streamable HTTP). The SSE endpoint `https://mcp.notion.com/sse` retires on 23 February 2027.
- **Auth:** OAuth 2.0 authorization code with PKCE (S256). The authorization server metadata advertises `registration_endpoint` (DCR), `client_id_metadata_document_supported: true` (CIMD), `token_endpoint_auth_methods_supported` including `none` and `private_key_jwt`, `authorization_response_iss_parameter_supported: true`, revocation and introspection endpoints. Notion's guide says to reuse an existing client ID, otherwise publish a CIMD, otherwise use DCR, and to "register once and store the result per issuer".
- **Scopes:** the protected resource lists only `default`. The authorization server also lists `ema_issuer:manage`, which is for enterprise-managed authorization.
- **Tokens:** "Access tokens expire". Refresh can rotate, so the new `refresh_token` must be stored. On `invalid_grant`, do not retry; the student must re-authorize. No lifetimes are stated (**unverified**). The first token response also identifies the account (`workspace_id`, `user_id`, `bot_id`, `workspace_name`), and refresh responses omit these, so store them at connect time. An MCP token works only against Notion MCP, not the REST API.
- **Headless use:** OAuth works for any plan. Bearer "MCP tokens" with no browser sign-in exist only on Business and Enterprise plans. Guests cannot connect; only workspace members can.
- **Tools:** about 70, including search and fetch, pages, databases and views, comments, files, calendar (`notion-calendar-*`), Skills, memories and Custom Agent sessions. Availability depends on plan and admin settings; `notion-get-tool-access` reports it.
- **Annotations:** the docs state `destructiveHint: true` for `notion-delete-pages` and `notion-delete-databases`. These tools also require `user_confirmed: true` in the arguments. Annotations for the other tools are not published (**unverified**; read them from `tools/list` with a token).
- **Rate limits:** the standard API limits apply to every tool call: 180 requests per minute per connection (Free and Plus), 600 per minute (Business and Enterprise), plus a shared per-workspace limit. The server retries once if the wait is 2 seconds or less. Otherwise it returns a tool error with `structuredContent.error.code = "rate_limited"` and `retry_after_seconds`.
- **Admin gates:** Enterprise admins can approve clients and block tools. Lower plans have no client allowlist.
- **Data location:** Free and Plus workspaces are hosted in the United States. EU data residency (Frankfurt) is Enterprise-only and covers data at rest only; integrations are explicitly out of its scope. Where `mcp.notion.com` itself processes is not stated (**unverified**).

### Google Workspace (Calendar, Drive, and others)

Sources: [Configure the Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers), [Calendar MCP reference](https://developers.google.com/workspace/calendar/api/v3/reference/mcp) and [`delete_event`](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/delete_event), [Drive MCP reference](https://developers.google.com/workspace/drive/api/reference/mcp) and [`create_file`](https://developers.google.com/workspace/drive/api/reference/mcp/tools_list/create_file), [Cloud MCP supported products](https://docs.cloud.google.com/mcp/supported-products), [Usage tiers and quotas](https://developers.google.com/workspace/guides/quota-usage-tiers), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2).

- **URLs:** there is one server per product. Calendar is `https://calendarmcp.googleapis.com/mcp/v1` and Drive is `https://drivemcp.googleapis.com/mcp/v1`. Gmail, Docs, Sheets, Slides, Chat, People, **Classroom** (`classroommcp.googleapis.com`) and a Universal Search server (`workspacemcp.googleapis.com`) follow the same pattern. Transport: Streamable HTTP. There are only global endpoints, with no regional variants.
- **Status, which is contradictory:** the configuration guide and the per-product references say "Developer Preview", available through the Workspace Developer Preview Program. The quotas page treats the Gmail, Calendar, Drive, Docs, Sheets, Slides, Chat and Tasks servers as covered by tiers launched 24 November 2026, and bills Gmail, Calendar and Drive MCP usage on the Scaled Tier from 1 April 2027. **Unverified** whether a production app outside the preview program can call them today.
- **Auth:** pre-registered only. The guide mentions neither DCR nor CIMD. nunio needs a Google Cloud project, the product API and its MCP service enabled, and a **Web** OAuth client with "Use this client for an AI-powered agent" selected (the guide says to check this setting first when requests are rejected). Access is online by default; `access_type=offline` gives a refresh token. Prompts and responses must be screened (Model Armor or a documented alternative).
- **Scopes (prefix `https://www.googleapis.com/auth/`):** Calendar uses `calendar.calendarlist.readonly`, `calendar.events.freebusy`, `calendar.events.readonly` and `calendar.events`. Drive uses `drive.readonly` and `drive.file`. Classroom has its own set. `drive.readonly` is a **restricted** scope: it needs restricted-scope verification, plus a security assessment if the data is stored on or sent through servers. `drive.file` is non-sensitive. The Calendar scope page does not classify its scopes (**unverified**; the Cloud console shows it).
- **Tokens:** the access token lasts 1 hour (the guide says to request offline access "to avoid signing in again every hour"). A refresh token stops working when it has not been used for six months, when the user revokes access, or when the user changes password and the token has Gmail scopes. A project with External user type in "Testing" status gets refresh tokens that expire after **7 days**. There is a limit of 100 live refresh tokens per Google Account per client; the oldest is silently invalidated.
- **Tools:** Calendar has `list_events`, `get_event`, `list_calendars`, `suggest_time`, `create_event`, `update_event`, `delete_event`, `respond_to_event` and `search_events`. Drive has `search_files`, `get_file_metadata`, `get_file_permissions`, `list_recent_files`, `read_file_content`, `download_file_content`, `create_file` and `copy_file`.
- **Annotations:** published per tool. For example, `delete_event` is destructive, idempotent, not read-only and not open-world. `create_file` is not destructive, not idempotent, not read-only and open-world. Each tool page also lists the scopes that satisfy it.
- **Rate limits:** the free Standard Tier allows 5,000 requests per day, **per project, per product**, plus per-minute limits, and cannot be raised. Some tools count as several requests. On the Scaled Tier, Gmail, Calendar and Drive MCP calls are billed from the first request, from 1 April 2027. From 1 February 2027, "AI agents or similar access tools" must use the MCP servers instead of REST, under the Workspace AI Tools Addendum.
- **Account types:** the guide does not say whether consumer `@gmail.com` accounts work (**unverified**). Its audience step ("Internal", otherwise "External" with test users) suggests they can.
- **Data location:** consumer Google accounts have no data-region choice, and the guide says nothing about where the MCP servers process (**unverified**).

### Linear

Sources: [Linear MCP server](https://linear.app/docs/mcp), [Rate limiting](https://linear.app/developers/rate-limiting), [Security: data regions](https://linear.app/docs/security), [DPA](https://linear.app/dpa), discovery documents on `mcp.linear.app`.

- **URLs:** `https://mcp.linear.app/mcp`. A read-only endpoint, `https://mcp.linear.app/mcp/readonly`, "only ever exposes read tools". `/sse` is deprecated.
- **Auth:** "OAuth 2.1 with dynamic client registration". The metadata also advertises `client_id_metadata_document_supported: true`, PKCE S256 and `iss` in responses. Bearer API keys and OAuth tokens are accepted too, including as an `app` actor.
- **Scopes:** `read` and `write`. A client that asks only for `read` gets a token that "can't reach write APIs".
- **Tokens:** "Standard MCP OAuth connections start with a 25-day refresh window", which can renew on refresh. In practice a Connection left unused for about 25 days needs re-authorization (**inferred** from that sentence). Each workspace needs its own authorization.
- **Tools:** these cover issues, projects, comments and documents. No tool list or annotations are published (**unverified**).
- **Rate limits:** OAuth apps get 5,000 requests and 2,000,000 complexity points per hour per user, more on Business and Enterprise. The page does not say whether MCP traffic counts toward these (**unverified**).
- **Data location:** the region (US or EU) is chosen when the workspace is created. Account data, analytics and notification email stay in the US, and the DPA says Linear's "primary processing operations take place in the United States". Whether `mcp.linear.app` serves EU workspaces from the EU is **unverified**.

### GitHub

Sources: [Remote GitHub MCP Server](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md), [Host integration](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md), [Scope filtering](https://github.com/github/github-mcp-server/blob/main/docs/scope-filtering.md), [README](https://github.com/github/github-mcp-server/blob/main/README.md), the tool definitions in [`pkg/github`](https://github.com/github/github-mcp-server/tree/main/pkg/github), [Set up the GitHub MCP server](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server), [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens), [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), discovery documents on `api.githubcopilot.com`.

- **URL:** `https://api.githubcopilot.com/mcp/`. There is a read-only variant (`/readonly` or the `X-MCP-Readonly` header) and per-toolset paths (`/x/{toolset}`, or `X-MCP-Toolsets`). The server is "available to all GitHub users regardless of plan type". Tools that need Copilot need a Copilot licence.
- **Auth:** pre-registered only. The protected resource names `https://github.com/login/oauth` as the authorization server, and its metadata has no `registration_endpoint` and no CIMD support. In GitHub's words, "Each MCP host application needs to configure a GitHub App or OAuth App". A GitHub App is recommended. Organizations can block apps until an owner approves them. PATs also work.
- **Scopes:** the resource lists `repo`, `read:org`, `read:user`, `user:email`, `read:packages`, `write:packages`, `read:project`, `project`, `gist` and `notifications`. With OAuth, the server issues **scope challenges** at runtime rather than hiding tools, so step-up re-authorization is the normal path.
- **Tokens:** GitHub App user tokens last 8 hours and refresh tokens 6 months. Refresh rotates both, and the old pair stops working at once.
- **Annotations:** every tool in the source sets `ReadOnlyHint` (for example `issue_read` true, `issue_write` false). `DestructiveHint: true` is set explicitly on a few, such as `delete_file` and the delete-repository tool. The others are writes with no explicit destructive hint, which by the spec's default means possibly destructive.
- **Rate limits:** user tokens get 5,000 REST requests per hour. Content-creating requests are capped at about 80 per minute and 500 per hour.
- **Data location:** github.com processes in the US, and the response edge region seen was `iad`. Data residency exists only for GitHub Enterprise Cloud on `ghe.com`, with its own endpoint (`copilot-api.<sub>.ghe.com/mcp`), which students won't have.

### Atlassian (Jira, Confluence)

Sources: [Get started with the Atlassian MCP server](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/), [Supported tools](https://support.atlassian.com/atlassian-ai-gateway/docs/supported-tools/), [Configure OAuth 2.1](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/), [Control MCP server settings](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-rovo-mcp-server-settings/), [Available MCP server domains](https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-mcp-server-domains/), discovery document on `mcp.atlassian.com`.

- **URL:** `https://mcp.atlassian.com/v2/mcp`. v1 users move to v2 tools automatically on 1 March 2027.
- **Auth:** OAuth 2.1. The metadata advertises DCR (`/v1/register`) but **no CIMD**, and the server returned no protected resource metadata at the usual paths. API tokens are optional and an admin can turn them off. **Org admin gate:** OAuth clients must come from an allowed domain. By default only "Atlassian supported domains" (such as `claude.ai`, `chatgpt.com` and `app.notion.com`) are allowed, so nunio's domain would have to be added by every site's admin, or listed by Atlassian.
- **Tools:** about 200, grouped by permission (`read_jira`, `write_jira`, `delete_jira`, `read_confluence` and so on). Each tool inherits its group's access. `delete_jira` and `manage_jira` are off until an admin enables them. There are also generic `executeRead`, `executeWrite` and `executeDestructive` tools, used "to apply agent-level confirmation". Annotations are not documented (**unverified**).
- **Cost and limits:** "Enriched" tools consume Rovo credits even when AI is off for the site. No rate limits are documented (**unverified**).
- **Data location:** not stated for MCP (**unverified**).

### Microsoft 365 (Outlook, OneDrive; Work IQ)

Sources: [Work IQ API overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/api-overview), [MCP server options in Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview), [Work IQ MCP tool reference](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/tool-reference).

- **URL:** `https://workiq.svc.cloud.microsoft/mcp`. The older per-workload servers (Mail, Calendar and others under Agent 365) are "legacy" and kept for compatibility.
- **Auth:** Entra ID delegated only, with no app-only auth. It needs a multitenant Entra app registration, the tenant must enable Work IQ, and use is billed in Copilot Credits under the tenant's agreement. Consumer Microsoft accounts are not mentioned, so they are **presumably unsupported**.
- **Tools:** about 10 generic tools that discover resource paths and schemas at runtime. Writes are blocked by tenant policy by default.
- **OneNote:** there is no official MCP server; only a Microsoft Q&A answer says so.
- **Data location:** EU Data Boundary coverage of Work IQ is **unverified**.

Verdict: this needs a university tenant's admin, licence and credits, so it is out of reach for a student-connected v1.

## Comparison

| | Notion | Google Calendar / Drive | Linear | GitHub | Atlassian | Microsoft Work IQ |
| - | - | - | - | - | - | - |
| MCP URL | `mcp.notion.com/mcp` | `calendarmcp.googleapis.com/mcp/v1`, `drivemcp…` | `mcp.linear.app/mcp` (+`/readonly`) | `api.githubcopilot.com/mcp/` (+`/readonly`) | `mcp.atlassian.com/v2/mcp` | `workiq.svc.cloud.microsoft/mcp` |
| Status | GA (Notion still labels the resource "Beta") | Preview per references; GA per quota page | GA | GA | GA (v2) | Microsoft 365 product, tenant-enabled |
| Client registration | CIMD, DCR | Pre-registered Google Cloud client ("AI-powered agent") | CIMD, DCR | Pre-registered GitHub App or OAuth App | DCR only | Pre-registered Entra app |
| Extra gate | none (Enterprise may allowlist) | App verification; restricted scopes need a security assessment | none | Org app approval for org data | Org admin domain allowlist | Tenant enablement, Copilot Credits |
| Scopes | `default` | per product, e.g. `calendar.events(.readonly)`, `drive.file` | `read`, `write` | classic scopes, step-up challenges | per product group | `WorkIQAgent.Ask` |
| Token lifetime | not stated; refresh rotates | access 1 h; refresh dies after 6 months unused (7 days in Testing) | 25-day refresh window | 8 h access, 6-month refresh, rotating | not stated | not stated |
| Annotations | `destructiveHint` on deletes; rest unpublished | published per tool | unpublished | `readOnlyHint` on all; `destructiveHint` on some | unpublished; generic `execute*` tools | unpublished; generic tools |
| Rate limits | 180/min per connection (Free/Plus) | 5,000/day per project per product (free tier); billing from 1 Apr 2027 | 5,000/h per user (MCP unconfirmed) | 5,000/h; 80 writes/min | not documented; Rovo credits | Copilot Credits |
| Data location for a typical student | US (EU only on Enterprise, at rest) | global, no choice (unverified) | US or EU by workspace; MCP unverified | US | unverified | tenant; EU Data Boundary unverified |
| Fit for v1 | **high** | **high** (if usable outside preview) | medium | medium | low | low |

## What this means for the Connection model (paper-check input)

Each point follows from the sources above. Each is something an SMTP-shaped Connection model would miss.

1. **Client registration belongs to the Integration, not the Connection.** It is pre-registered (Google, GitHub), a CIMD URL nunio hosts (Notion, Linear), or a DCR result stored once per issuer (Atlassian). The spec binds it to the authorization server's `issuer`, and if the issuer changes nunio must re-register, not silently reuse it. The catalog entry therefore needs more than "MCP URL, logo, description, auth": it also needs the expected issuer and the registration kind. The secret lives server-side.
2. **The Connection holds tokens that change.** These are an access token, a refresh token that may rotate, an expiry, the granted scopes and the resource. A refresh that rotates makes the old refresh token invalid at once (GitHub, Notion). So two concurrent refreshes, for example a Chat in the API and a Run in the worker, can strand a Connection. Refresh must be serialized per Connection.
3. **A Connection can go stale without a Disconnect.** Causes are `invalid_grant`, Linear's 25-day refresh window, Google's 6-month-unused or 7-day Testing expiry, Google's 100-token cap, and admin revocation. The model needs a "needs re-authorization" state that Runs notice and report rather than retry. This touches the map's open Unconfirmed and durability item.
4. **Scopes are not fixed at connect time.** Linear's `read` versus `read write`, Google's per-product scopes and GitHub's step-up challenges mean the student's per-Connection Capability (reading on or off, writes Nachfragen or Immer erlaubt) and the OAuth scopes interact. A read-only Connection can ask only for read scopes, or use the read-only endpoint (Linear, GitHub). Turning writes on later then needs a re-authorization with the union of scopes, which the student must do in the foreground. A background Run cannot.
5. **Identity comes from the token response or a tool, not from the student.** Notion returns `workspace_id` and `user_id` only on the first exchange. "One Connection per Integration" should record which account or workspace it is, for display and for spotting a reconnect to a different account.
6. **nunio's classification must be per tool, and sometimes per call.** Annotations are hints, absent for most servers, and untrusted by spec. Atlassian's `executeWrite` and `executeDestructive` and Work IQ's generic tools mean the tool name alone does not settle read versus write. Either the catalog leaves such servers out, or it treats every generic tool as a write. Tool lists can also change (`listChanged`, `ttlMs`) and vary by scope, so a tool nunio has not classified must default to "write, always ask".
7. **Rate limits come back as tool errors, not HTTP errors** (Notion: `rate_limited` with `retry_after_seconds`), and Google's quota is per nunio project, shared by all students. Metering and backoff belong to the Integration, which feeds the map's metering item.
8. **ADR-0008.** Tokens and tool results stored by nunio stay in its EU stack (Neon `aws-eu-central-1`). The vendors themselves process in the US or globally for typical student accounts. Like the browser push services in the 2026-11-09 amendment, they are services the student chose and holds an account with, so they are not nunio's processors. Tool results do go to the model provider under ADR-0012's routing. An ADR-0008 amendment should say this explicitly for Integrations, as it did for push. Whether a legal review agrees is outside this note.

## Unverified

- Live `tools/list` annotations for Notion (other than its delete tools), Linear, Atlassian and Work IQ. These need an authorized connection.
- Token lifetimes for Notion, Atlassian and Work IQ.
- Whether the Google Workspace MCP servers can be used outside the Developer Preview Program today, whether consumer `@gmail.com` accounts work, and how Google classifies the Calendar scopes.
- Where `mcp.notion.com`, `mcp.linear.app` (for EU workspaces), `mcp.atlassian.com` and Work IQ process data.
- Whether Linear's MCP traffic counts toward its API rate limits, and Atlassian's MCP rate limits.
