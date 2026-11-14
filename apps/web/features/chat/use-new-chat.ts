import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import { forgetOpenChat } from "./open-chat-cookie";

/** Starts an empty Chat, also on ⌘⇧O or Ctrl+Shift+O; the one open now is no longer reopened on return. */
export function useNewChat() {
  const router = useRouter();
  const start = () => {
    forgetOpenChat();
    router.push("/chat");
  };
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // ⌘⇧N would open a private window instead, which no page can prevent.
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "o"
    ) {
      event.preventDefault();
      start();
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return start;
}
