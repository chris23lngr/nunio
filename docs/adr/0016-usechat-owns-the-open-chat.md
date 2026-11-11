---

## status: accepted

# useChat owns the open Chat's messages

The Chat screen uses `useChat` from `@ai-sdk/react`, and its message list is the single list the open Chat renders. That breaks the web rule against mirroring query results in React state ([apps/web/README.md](../../apps/web/README.md), "Server-state ownership"). We accept the exception for this one screen so that a turn keeps one element from the first streamed word to its saved form. Before, the streamed answer was thrown away and rebuilt from the cache. React Query still loads the Chat. Every refetch replaces the saved messages in `useChat` by ID and keeps a turn still being answered after them. That sync is what makes an answer withdrawn by a Source deletion disappear from an open Chat. After an answer is saved, the screen invalidates the Chat query and never writes the turn into the cache itself.

Stable IDs make this work. The client creates the question's ID, which the stream route stores (rejecting a reused one with 409). The route also announces the answer's ID in the stream's `start` chunk before generating, so both messages already carry their saved IDs while they stream. A saved turn is only confirmed by `data-committed`, never by the end of the stream ([streaming-chat.md](../research/streaming-chat.md)). On Stop, a refusal or a broken stream, the turn is removed and the draft restored. The research behind this decision is in [chat-responsiveness.md](../research/chat-responsiveness.md).

## Considered Options

- **React Query plus a hand-written stream reader (the previous design):** follows the rule, but the swap from the streamed answer to the saved one recreated its elements.
- **Split ownership:** Query keeps saved history and `useChat` holds only this visit's turns, matched by ID. It avoids the exception, but we preferred one list for the screen and the AI SDK's standard message model.
