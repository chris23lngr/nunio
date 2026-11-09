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
export function PushSettings({ apiOrigin }: { apiOrigin: string }) {
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
      if ((await Notification.requestPermission()) !== "granted")
        return setState("blocked");
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
    } catch {
      setError(
        "Could not turn on notifications. Your Inbox still has everything.",
      );
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
        await createApiClient(apiOrigin).DELETE("/api/me/push-subscriptions", {
          body: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Could not turn off notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Notifications on this device">
      <h2>Notifications on this device</h2>
      {error && <p role="alert">{error}</p>}
      {state === "unsupported" && (
        <p>
          This browser cannot show notifications from nunio. On an iPhone or
          iPad, add nunio to your Home Screen first (Share, then Add to Home
          Screen) and turn them on there. Your Inbox has everything either way.
        </p>
      )}
      {state === "blocked" && (
        <p>
          Notifications are blocked for nunio in this browser. Everything still
          arrives in your Inbox; allow notifications in the browser's site
          settings to turn them on.
        </p>
      )}
      {state === "off" && (
        <>
          <p>A notification only says that something is new, never what.</p>
          <button type="button" disabled={busy} onClick={turnOn}>
            Turn on notifications on this device
          </button>
        </>
      )}
      {state === "on" && (
        <>
          <p>Notifications are on for this device.</p>
          <button type="button" disabled={busy} onClick={turnOff}>
            Turn off on this device
          </button>
        </>
      )}
    </section>
  );
}
