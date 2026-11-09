// nunio's service worker: shows browser push and keeps its subscription alive, nothing else (Phase 10).
// Pushes carry no payload, so the notification never says what is new; tapping it opens the Inbox.

// The API origin, from the URL push-settings.tsx registers this worker with (`/sw.js?api=…`).
const api = new URL(self.location.href).searchParams.get("api");

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("nunio", {
      body: "You have something new in nunio.",
      tag: "nunio",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((w) => new URL(w.url).pathname === "/inbox");
        return open ? open.focus() : self.clients.openWindow("/inbox");
      }),
  );
});

// The browser may replace a subscription on its own: save the new one and forget the old, so pushes
// keep arriving without the student turning them on again. Its Origin is the app's, as the API requires.
self.addEventListener("pushsubscriptionchange", (event) => {
  if (api) event.waitUntil(renew(event.oldSubscription, event.newSubscription));
});

async function renew(old, current) {
  const send = async (method, body) => {
    const response = await fetch(`${api}/api/me/push-subscriptions`, {
      method,
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} failed: ${response.status}`);
  };
  const subscription =
    current ??
    (await self.registration.pushManager.subscribe(
      old?.options ?? {
        userVisibleOnly: true,
        applicationServerKey: await key(),
      },
    ));
  await send("POST", subscription.toJSON());
  if (old && old.endpoint !== subscription.endpoint)
    await send("DELETE", { endpoint: old.endpoint });
}

/** nunio's VAPID public key; subscribe() takes it as the base64url string the API returns. */
async function key() {
  const response = await fetch(`${api}/api/me/push-key`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`push-key failed: ${response.status}`);
  return (await response.json()).publicKey;
}
