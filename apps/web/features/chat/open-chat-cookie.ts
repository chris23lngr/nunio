/**
 * The Chat last open on this device, so returning to /chat reopens it for a while. It names the student so a
 * shared browser never reopens another account's Chat.
 */
export const openChatCookie = "nunio_open_chat";
const maxAgeSeconds = 30 * 60;

/** Remembers `chatId` as the open Chat for the next thirty minutes. */
export function rememberOpenChat(userId: string, chatId: string) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: The Cookie Store API is missing in browsers we support.
  document.cookie = `${openChatCookie}=${encodeURIComponent(`${userId}:${chatId}`)}; path=/; max-age=${maxAgeSeconds}; samesite=lax${secure}`;
}

export function forgetOpenChat() {
  // biome-ignore lint/suspicious/noDocumentCookie: The Cookie Store API is missing in browsers we support.
  document.cookie = `${openChatCookie}=; path=/; max-age=0`;
}

/** The remembered Chat in the cookie's (decoded) `value`, if it is `userId`'s. */
export function openChatOf(value: string | undefined, userId: string) {
  const [owner, chatId] = value?.split(":") ?? [];
  return owner === userId && chatId ? chatId : null;
}

/** The Chat remembered on this device for `userId`, read in the browser. */
export function rememberedChat(userId: string) {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${openChatCookie}=`))
    ?.slice(openChatCookie.length + 1);
  return openChatOf(value && decodeURIComponent(value), userId);
}
