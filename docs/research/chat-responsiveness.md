# Chat responsiveness and loading state

Research date: 2026-11-10. Scope: research only on `main`. No implementation, installs, live model calls, or browser measurements. Inputs: [streaming note](./streaming-chat.md), [web conventions](../../apps/web/README.md), [ADR-0005](../adr/0005-separate-app-and-api-origins.md), the Chat feature and stream route, the shadcn chat example and AI Elements source, AI SDK docs, and installed/published package source. **Repository observations** describe the checkout. **Recommendations** are proposals. Claims about jank come from reading source and are not profiled. Verify them with the React Profiler and a staging trace before and after each change.

**Decision (2026-11-11):** we adopted `useChat` despite the recommendation below; see [ADR-0016](../adr/0016-usechat-owns-the-open-chat.md). Memoizing messages measurably stopped earlier messages re-rendering while an answer streams (0 instead of 230 renders over 20 updates in a 10-message Chat). A browser check did not reproduce the scroll jump on save described below, even with the previous client.

Upstream snapshots read: `shadcn-ui/ui@8ab2771` (2026-11-08) and `vercel/ai-elements@ca8be60` (2026-10-14).

## Finding and recommendation

Most of the sluggishness comes from the client, not the transport. Every 50 ms streaming tick re-renders and re-parses **every earlier answer** in the chat, and remounts its paragraphs and links. On commit, the pending turn is thrown away and replaced by new elements, which causes a remount, can leave a one-frame gap, and makes the scroller re-anchor. The first message of a new chat shows nothing until `POST /api/me/chats` returns. The waiting state is plain grey text. Each of these has a fix of a few dozen lines inside the current architecture.

The shadcn example feels instant partly because it is scripted: the transport replays canned turns with 16 ms between chunks ([chat-demo.tsx:155-159](https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/base/chat-demo.tsx)). It has no retrieval, embedding, allowance check, or model latency. Some of our wait cannot be removed and must be **communicated** instead: a shimmering, staged status.

- **Loading state (Q1):** use shadcn's **`shimmer` CSS utility** on our existing `Trace` running line. That is exactly what the linked example does. Don't use AI Elements `Loader`, which no longer exists upstream. AI Elements `Shimmer` is a reasonable second choice, but it needs `motion` and theme variables we don't define. Show it while `send.isPending && !partial && !reasoning.text`, and also during `create.isPending` for a new chat.
- **useChat (Q3):** **not now.** It would not fix the main causes (list re-rendering, Markdown cost, identity swap at commit). It would also add a second message store and needs server stream changes. Adopt its *status vocabulary* locally. Revisit when chat gains multi-turn context, tools, regenerate/edit, or resume.

## Repository observations

**Loading text.** It is inline TSX, not i18n: `"nunio antwortet …"` before any chunk, and `"Antwort wird geschrieben …"` under streaming text ([chat-screen.tsx:286-292](../../apps/web/features/chat/chat-screen.tsx)). Reasoning shows `"Denkt nach …"` ([reasoning.tsx:37](../../packages/ui/src/components/ui/reasoning/reasoning.tsx)). E2E matches both strings ([chat.spec.ts:223](../../apps/e2e/tests/chat.spec.ts)). Stories assert `"Denkt nach …"` ([reasoning.stories.tsx:49,73,90](../../packages/ui/src/components/ui/reasoning/reasoning.stories.tsx)).

**No AI Elements installed.** There is no `Shimmer`, `Loader`, `Conversation`, `MessageResponse`, or Streamdown anywhere. The UI uses shadcn's newer primitives (`MessageScroller` from `@shadcn/react@0.3.1`, `Message`, `Bubble`, `Trace`, `Reasoning`) and a `react-markdown` renderer ([mdx.tsx](../../packages/ui/src/components/ui/mdx/mdx.tsx)). Our `Trace` running title pulses (`animate-pulse`, [trace.tsx:37](../../packages/ui/src/components/ui/trace/trace.tsx)). It also carries a mangled `motion-reduce:motion-safe:animate-pulse-none` class ([trace.tsx:64](../../packages/ui/src/components/ui/trace/trace.tsx)). Upstream uses `data-[status=running]:*:data-[slot=trace-title]:shimmer` and `motion-reduce:shimmer-none` ([registry trace.tsx:36,63](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/trace.tsx)). The `shimmer` utility was never ported, because `globals.css` doesn't import `shadcn/tailwind.css` ([globals.css:1-6](../../packages/ui/src/styles/globals.css)).

**Whole-list re-render per tick.** `setPartial`/`setReasoning` live in `ChatScreen` ([chat-screen.tsx:75-76](../../apps/web/features/chat/chat-screen.tsx)), so every flush re-renders `messages.map(<ChatMessage>)` ([:254-262](../../apps/web/features/chat/chat-screen.tsx)). `ChatMessage` isn't memoized and rebuilds `references` on every render ([chat-message.tsx:21](../../apps/web/features/chat/components/chat-message.tsx)). `MdxContent` isn't memoized and re-runs remark-gfm, remark-math, KaTeX, and the reference plugin over the full text. It also passes **inline** `components.p/a/li` and a fresh plugin array on each render ([mdx.tsx:125-170](../../packages/ui/src/components/ui/mdx/mdx.tsx)). A new function identity is a new component type, so React remounts those subtrees on every render ([React: never define components inside components](https://react.dev/learn/your-first-component#nesting-and-organizing-components)). This plausibly explains lost text selection and flicker during streaming. The cost grows with chat length, and the streaming answer itself is fully re-parsed each tick, which is O(n²) over an answer.

**Batching.** A 50 ms trailing timer ([chat-mutations.ts:104-111](../../apps/web/features/chat/api/chat-mutations.ts)) adds at most 50 ms to the first visible token. That is comparable to the AI SDK's optional `throttle`, which is off by default ([useChat reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)). Batching is **not** the problem. The work done per tick is.

**Commit swap.** The pending turn is keyed `pending-question`/`pending-answer` ([chat-screen.tsx:265-277](../../apps/web/features/chat/chat-screen.tsx)). The committed turn is keyed by server IDs ([:255-257](../../apps/web/features/chat/chat-screen.tsx)), so React unmounts the streamed answer and mounts a new one. Ordering creates a likely gap:

1. TanStack dispatches mutation `success` and returns data. Observers are notified on `setTimeout(0)` ([mutation.js:199-202](../../node_modules/.bun/@tanstack+query-core@5.105.3/node_modules/@tanstack/query-core/build/modern/mutation.js), [notifyManager.js:5-7](../../node_modules/.bun/@tanstack+query-core@5.105.3/node_modules/@tanstack/query-core/build/modern/notifyManager.js)).
2. The screen then `await`s `cancelQueries` and only afterwards calls `setQueryData` ([chat-screen.tsx:129-146](../../apps/web/features/chat/chat-screen.tsx)).

So `isPending=false`, which removes the pending block, can render before the committed messages exist. The scroller's content handler then sees a new, unhandled `scrollAnchor` element and scrolls it to the top again. It tracks handled anchors by DOM element in a `WeakSet` (`handleContentChange`, `ze`/`Ye`, `scrollToElement(..., {align:"start"})` in `@shadcn/react/dist/message-scroller/index.js`). A reader who scrolled down while streaming would be pulled back to the question. The footer row also appears and the status line disappears, a small layout shift ([chat-message.tsx:54](../../apps/web/features/chat/components/chat-message.tsx)).

**First message of a new chat.** On submit the composer clears, but the greeting stays until `create.mutateAsync` resolves ([chat-screen.tsx:97-108](../../apps/web/features/chat/chat-screen.tsx)). The question bubble renders only from `send.isPending`/`send.variables` ([:263-272](../../apps/web/features/chat/chat-screen.tsx)). `MessageScrollerProvider key={id ?? "new"}` then remounts the scroller ([:223-224](../../apps/web/features/chat/chat-screen.tsx)). `router.replace` also triggers an RSC round trip during the stream ([:108](../../apps/web/features/chat/chat-screen.tsx); [page.tsx](../../apps/web/app/(app)/chat/page.tsx) re-runs `getSession`).

**Composer locked while streaming.** It is `readOnly={busy}` ([chat-screen.tsx:372](../../apps/web/features/chat/chat-screen.tsx)). The example keeps the textarea editable and only disables send (`canSend`, [chat-demo.tsx:174,309-321,360](https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/base/chat-demo.tsx)).

**Time to first token (server).** The route does auth and a Chat `detail` query, then opens the SSE response and immediately writes `start` and `text-start` ([chats.ts:94-101](../../apps/api/src/chats.ts)). Everything else happens inside the stream, in sequence:

1. Retrieval: query-embedding cache lookup, otherwise a metered embedding call (reserve, provider, settle, insert) ([reader.ts:384-420,663](../../packages/knowledge/src/reader.ts)), then vector search.
2. Answer allowance reservation ([chats.ts:134](../../packages/knowledge/src/chats.ts)).
3. Model TTFT, then reasoning (Sonnet 5.5, [models.ts:42](../../packages/ai/src/models.ts)).

After the last delta, encryption and persistence run before `data-committed` ([knowledge chats.ts:163-209](../../packages/knowledge/src/chats.ts); [api chats.ts:129](../../apps/api/src/chats.ts)). The browser calls the API origin directly, so there is no Next.js proxy hop ([ADR-0005](../adr/0005-separate-app-and-api-origins.md), [chat-mutations.ts:56](../../apps/web/features/chat/api/chat-mutations.ts)). The response sets `x-accel-buffering: no` and 15 s keep-alives ([chats.ts:138-139](../../apps/api/src/chats.ts)). No per-stage timing is emitted, so it is unknown how much of the wait is retrieval and how much is the model.

**React Query.** The success path performs no refetch (`cancelQueries` + `setQueryData`); only failure invalidates ([chat-screen.tsx:129-151](../../apps/web/features/chat/chat-screen.tsx)). A 30 s `staleTime` ([query-client.ts:16](../../apps/web/lib/query-client.ts)) means a focus refetch during a long answer re-renders history. That is minor, and becomes negligible once list items are memoized. The wait for `data-committed` doesn't delay any visible text. It only delays the swap and the footer.

## How the shadcn example wires it

The page links to `ChatDemo` ([docs](https://ui.shadcn.com/docs/ai-elements/base/chat), [source](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/ai-elements/base/chat.mdx)):

- It calls `useChat({ messages, transport })` and derives `busy = status === "submitted" || status === "streaming"` ([chat-demo.tsx:164-172](https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/base/chat-demo.tsx)).
- `streaming = busy && message === messages.at(-1)`.
- Reasoning rows run while `part.state === "streaming"`, rendered as a `TraceLine status="running"` with a spinner and "Thinking"/"Thought" ([:268, 376-412](https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/base/chat-demo.tsx)). The shimmer comes from the trace's `running` style, not from a separate component.
- Markdown is Streamdown with stable `components` ("Streamdown memoizes on components, so keep the default stable", [components/markdown.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/components/markdown.tsx)).
- New user messages slide in via `motion` and respect reduced motion ([chat-demo.tsx:247-253](https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/base/chat-demo.tsx)).
- `MessageContent` gets `aria-busy={busy}` ([:241](https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/base/chat-demo.tsx)).

The `shimmer` utility is pure CSS (`background-clip:text`, keyframes, derived from `currentColor`), automatically disabled under reduced motion, and ships in `shadcn/tailwind.css` ([docs](https://ui.shadcn.com/docs/utils/shimmer), [source](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/utils/shimmer.mdx); `shadcn@4.23.0` `dist/tailwind.css:521-640`). Its documented status pattern is `<Marker role="status">… <MarkerContent className="shimmer">Thinking…</MarkerContent>`.

The alternatives:

- **AI Elements `Shimmer`:** a `motion` component that animates `background-position` and uses `--color-background`/`--color-muted-foreground` ([shimmer.tsx](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/shimmer.tsx)). Our theme defines neither variable.
- **AI Elements Reasoning:** renders `<Shimmer duration={1}>Thinking...</Shimmer>` while `isStreaming` ([reasoning.tsx:157-165](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/reasoning.tsx)).
- **AI Elements `Loader`:** absent from `packages/elements/src` at the snapshot above.

**Status mapping.**

| AI SDK `ChatStatus` | Meaning | Our equivalent |
| --- | --- | --- |
| `submitted` | request sent, before the stream writes the message | `create.isPending \|\| (send.isPending && !partial && !reasoning.text)` |
| `streaming` | receiving response | `send.isPending && (partial \|\| reasoning.text)` |
| `ready` / `error` | idle / request failed | `!busy` / `send.error` |

Sources: [useChat reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat); [installed chat.ts:134,989,1088](../../node_modules/.bun/ai@7.0.157+969a6d035afea0f4/node_modules/ai/src/ui/chat.ts).

Caveat: in the SDK, a `text-start` chunk calls `write()`, which sets `streaming` ([process-ui-message-stream.ts:~500](../../node_modules/.bun/ai@7.0.157+969a6d035afea0f4/node_modules/ai/src/ui/process-ui-message-stream.ts)). Our API sends `text-start` **before retrieval** ([chats.ts:101](../../apps/api/src/chats.ts)), so under `useChat` the shimmer would vanish immediately.

## Recommendations, ranked by expected effect on perceived speed and polish

1. **Make streaming ticks cheap (S, about 0.5 day; highest impact on longer chats).**
   - Wrap `ChatMessage` in `memo` and `useMemo` its `references`.
   - In `MdxContent`, hoist `components` and plugin arrays to module scope, and memoize per `(content, references)`.
   - Optionally move the pending turn into its own child component, so `partial` state doesn't re-render `ChatScreen`.
   - Verify with the React Profiler: commits per tick should touch only the pending turn.
2. **Seamless commit (S–M, about 0.5–1 day).**
   - Keep one element identity from pending to committed. Either pre-generate the canonical question/answer IDs before generation and send them early (e.g. `start.messageId` or a transient data part), or key both turns by a local turn ID.
   - Write the committed turn into the Query cache **inside** the stream loop when `data-committed` arrives. Then the cache update and the `isPending` flip land together, with no gap and no re-anchor scroll.
   - Reserve footer space or fade it in to avoid layout shift.
3. **Immediate first-turn feedback (S).**
   - On submit, switch to the conversation layout and render the question bubble plus the waiting line from local submit state, not `send.variables`.
   - Drop the `key={id ?? "new"}` scroller remount.
   - Consider `window.history.replaceState` for the URL, which Next.js integrates with `useSearchParams`; check `node_modules/next/dist/docs` per [apps/web/AGENTS.md](../../apps/web/AGENTS.md) before relying on it. This avoids an RSC round trip mid-stream.
4. **Shimmer waiting state (S, about 2–3 h).**
   - Vendor the MIT `shimmer` block from `shadcn@4.23.0` `dist/tailwind.css` into `packages/ui` styles. Importing `shadcn/tailwind.css` would add the CLI package (~30 deps) for one utility.
   - Change `TraceLine` running to `shimmer` and `TraceTitle` to `motion-reduce:shimmer-none`, matching upstream.
   - From submit onward, render `<Reasoning streaming>{reasoning.text}</Reasoning>`. Its empty-children branch already renders a `role="status"` line ([reasoning.tsx:45-46](../../packages/ui/src/components/ui/reasoning/reasoning.tsx)), so one element goes from waiting to reasoning to done.
   - Hide it at the first text delta if the model doesn't reason.
   - Remove the visible "Antwort wird geschrieben …" and keep a polite screen-reader status plus `aria-busy` on the content. Update [chat.spec.ts:223](../../apps/e2e/tests/chat.spec.ts) and the stories.
5. **Staged status and the real server wait (S for staging, M for measuring).**
   - Emit transient `data-status` parts ("Durchsuche Kursmaterial …" during retrieval, "Formuliere Antwort …" after reservation) and show them in the shimmer line.
   - Move `text-start` to just before the first delta.
   - Add `Server-Timing`/log spans for detail, embedding (cache hit or miss), vector search, reservation, model TTFT, and persistence. Measure in staging before optimizing retrieval itself.
6. **Streaming Markdown (M, about 1–2 days).**
   - Replace `react-markdown` for assistant text with Streamdown, as in [AI Elements MessageResponse](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx) (memoized on `children`/`isAnimating`) and the shadcn `Markdown`.
   - Streamdown 2.7.1 splits Markdown into memoized blocks (`parseMarkdownIntoBlocks`, memoized `Block`), completes unterminated syntax via `remend`, supports `mode="streaming"`, `isAnimating`, `caret`, `skipHtml`, and depends on `rehype-harden` (published `streamdown@2.7.1` `dist/index.d.ts:449,578-614,727-729`; `package.json` deps).
   - Port the citation `referencePlugin` and callouts, keep `skipHtml`, and use `@streamdown/math` for KaTeX.
   - This removes the O(n²) re-parse and the flashes of unterminated syntax. Ranked below 1–2 because those fixes capture most of the CPU win first.
7. **Composer stays editable while streaming (XS).** Keep `busy` only on send and Stop.
8. **Entrance motion (XS–S).** Slide in the user message and fade in the answer with `motion` (already a `packages/ui` dependency) and reduced-motion support, as in the example.
9. **Keep the 50 ms batching.** 30–50 ms is fine once each tick is cheap.

## useChat recommendation and tradeoffs

**Recommendation: keep `DefaultChatTransport` + Query + local turn state for now. Adopt the AI SDK status names locally.** Revisit `useChat` if chat gains multi-turn context, tools or approvals, regenerate/edit, or stream resume. Confidence: medium.

**For `useChat`:**

- A standard status machine.
- An optimistic user message.
- A parts model (reasoning, data parts) with `throttle`, `stop()`, and `regenerate`.
- Direct fit with AI Elements and shadcn examples.
- Less hand-written stream reducer code ([chat-mutations.ts](../../apps/web/features/chat/api/chat-mutations.ts)).

**Against `useChat`:**

- It becomes a second store for the open chat's messages. Seeding from Query, reconciling on focus refetch, and writing back the committed turn add exactly the synchronization the web conventions forbid ([README](../../apps/web/README.md), "Do not mirror query results"). The alternative is a documented convention exception where `useChat` owns the open chat.
- Our domain outcome is `data-committed`/`data-refused`, not stream finish. `useChat` would keep an assistant message on refusal or failure unless we remove it in `onData`/`onError`.
- It needs server changes: a late `text-start`, early stable IDs, and standard `reasoning-*` chunks instead of transient `data-reasoning`.
- It adds a dependency. Pin `@ai-sdk/react@4.0.161`, whose exact `ai` peer is `7.0.157` (matches ours). npm latest is `4.0.173` with `ai@7.0.169`.
- It doesn't fix recommendations 1, 4, or 6.

**Version notes:**

- The AI SDK docs now name the option `throttle`. `experimental_throttle` is a deprecated alias in 4.0.161 (published `dist/index.d.ts:116-123`).
- AI Elements `packages/elements` declares `ai ^6`, `@ai-sdk/react ^3`, `streamdown ^2.4`, and `use-stick-to-bottom` ([package.json](https://github.com/vercel/ai-elements/blob/main/packages/elements/package.json)).
- The shadcn site uses `ai` canary, `@ai-sdk/react 4.0.0-canary.162`, `streamdown ^2.5.0`, and `shadcn 4.23.0` ([apps/v4/package.json](https://github.com/shadcn-ui/ui/blob/main/apps/v4/package.json)).
- We have `ai 7.0.157` ([apps/web/package.json](../../apps/web/package.json)) and no `@ai-sdk/react` or `streamdown`. Copying AI Elements components therefore means checking their `ai` v6 type imports.
- shadcn now recommends rebuilding AI Elements `Conversation` on Message Scroller instead of `use-stick-to-bottom` ([docs](https://ui.shadcn.com/docs/ai-elements/base/chat)). We already use Message Scroller.

## Verification for follow-up work

- Profile a 20-turn chat during a streamed answer: commits per tick and scripting time per tick, before and after recommendations 1 and 6.
- Screen tests at the existing seams ([chat-screen.test.tsx](../../apps/web/features/chat/chat-screen.test.tsx)):
  - the waiting status appears on submit for new and existing chats;
  - the streamed answer's DOM node survives commit;
  - scroll position is kept on commit after a manual scroll;
  - the composer stays editable.
- Staging: per-stage timings for a cold and a cached embedding.
