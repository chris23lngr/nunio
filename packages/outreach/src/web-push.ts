import webpush from "web-push";
import type { Pusher } from "./sender.js";

/**
 * The Pusher as the worker runs it: web-push builds the VAPID-signed request and `fetch` sends it.
 * No payload, so push services see only the endpoint, timing and size (ADR-0008 amendment of 2026-11-09).
 */
export function createWebPusher({
  publicKey,
  privateKey,
  subject,
  fetch = globalThis.fetch,
}: {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: contact; Apple refuses pushes without one. */
  subject: string;
  fetch?: typeof globalThis.fetch;
}): Pusher {
  return {
    async send(subscription, { ttlSeconds, urgency }) {
      const request = webpush.generateRequestDetails(subscription, null, {
        TTL: ttlSeconds,
        urgency,
        vapidDetails: { subject, publicKey, privateKey },
      });
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers as Record<string, string>,
      });
      // The subscription expired or was revoked; RFC 8030 §7.3.
      if (response.status === 404 || response.status === 410) return "gone";
      if (!response.ok)
        throw new Error(`The push service answered ${response.status}`);
      return "sent";
    },
  };
}
