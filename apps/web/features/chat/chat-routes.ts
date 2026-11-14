/** Where a Chat opens. */
export const chatHref = (id: string) => `/chat?id=${id}`;

/** All Chats, with "Zurück" leading back to the Chat `from` when one was open. */
export const chatHistoryHref = (from: string | null) =>
  from ? `/chat/history?from=${from}` : "/chat/history";
