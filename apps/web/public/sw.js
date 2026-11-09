// nunio's service worker: shows browser push, nothing else (Phase 10).
// Pushes carry no payload, so the notification never says what is new; tapping it opens the Inbox.

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
