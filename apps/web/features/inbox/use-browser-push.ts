"use client";

import { useEffect, useState } from "react";
import { createApiClient } from "@/lib/api-client";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** The VAPID public key as the bytes PushManager.subscribe expects. */
function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * Opt-in browser push for this device. Pushes carry no content and only open the Inbox; without them,
 * everything still arrives in the Inbox and by email.
 */
export function useBrowserPush(apiOrigin: string) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      // Asked only from the student's tap, as Safari requires.
      if ((await Notification.requestPermission()) !== "granted") {
        setState("blocked");
        return false;
      }
      // The worker reads the API origin from its URL to renew a replaced subscription itself.
      await navigator.serviceWorker.register(
        `/sw.js?api=${encodeURIComponent(apiOrigin)}`,
      );
      const registration = await navigator.serviceWorker.ready;
      const api = createApiClient(apiOrigin);
      const key = await api.GET("/api/me/push-key");
      if (!key.data) throw new Error();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key.data.publicKey),
      });
      const saved = await api.POST("/api/me/push-subscriptions", {
        body: subscription.toJSON() as never,
      });
      if (!saved.data) throw new Error();
      setState("on");
      return true;
    } catch {
      setError(
        "Push-Benachrichtigungen konnten nicht aktiviert werden. Dein Posteingang zeigt weiterhin alles.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const removed = await createApiClient(apiOrigin).DELETE(
          "/api/me/push-subscriptions",
          {
            body: { endpoint: subscription.endpoint },
          },
        );
        if (removed.error) throw new Error();
        if (!(await subscription.unsubscribe())) throw new Error();
      }
      setState("off");
      return true;
    } catch {
      setError(
        "Push-Benachrichtigungen konnten nicht deaktiviert werden. Bitte versuche es erneut.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { state, error, busy, turnOn, turnOff };
}
