"use client";

import { useEffect } from "react";

const message =
  "Du hast ungespeicherte Änderungen. Möchtest du die Seite trotzdem verlassen?";

/** Covers links throughout the app, browser history traversal, and reload/close. */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function click(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      const destination = new URL(link.href);
      if (
        destination.origin === location.origin &&
        destination.pathname === location.pathname &&
        destination.search === location.search
      )
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function navigate(event: Event) {
      // The Navigation API lets history traversal be cancelled before Next changes routes.
      if (
        (event as Event & { navigationType: string }).navigationType ===
          "traverse" &&
        event.cancelable &&
        !window.confirm(message)
      )
        event.preventDefault();
    }
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [dirty]);
}
