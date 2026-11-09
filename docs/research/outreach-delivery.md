# Outreach delivery — Web Push and notification email

Checked 2026-11-09 for Phase 10 ("Outreach") of the [implementation plan](../implementation-plan.md). It extends the browser-side "Browser push" note in [pilot-delivery.md](pilot-delivery.md) with the server side, and covers notification email on Scaleway TEM ([ADR-0013](../adr/0013-scaleway-for-authentication-email.md)). It records documented interfaces and rules, not a tested integration or a legal assessment. Proposals are marked as such.

## 1. Server-side Web Push (RFC 8030, 8291, 8292)

Sources: [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) §5.2–5.4, §7.2–7.3, §8.1–8.2; [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) §2–4, §7; [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) §1, §2, §3.2, §4.2; [W3C Push API](https://www.w3.org/TR/push-api/) (Working Draft, 9 November 2026), `PushSubscription` IDL and "Security and privacy considerations".

Verified:

- **TTL** is mandatory: the push service returns 400 if it is missing. It may shorten the TTL (and reports the value it applied) and may expire a message early. With `TTL: 0`, the message is delivered only if the user agent is reachable at that moment (RFC 8030 §5.2, §7.2).
- **Urgency** (`very-low` | `low` | `normal` | `high`) is optional and defaults to `normal`. It is not forwarded to the user agent. A device can ask for higher urgencies only, for example on low battery (RFC 8030 §5.3, Table 1).
- **Topic** is optional, at most 32 characters from the URL-safe base64 alphabet (otherwise 400). A message with a Topic replaces a still-undelivered message with the same Topic, including its TTL and Urgency. The Topic is not forwarded to the user agent, but the push service can see it and use it for traffic analysis (RFC 8030 §5.4, §8.1).
- **Expired subscriptions:** the push service may expire a subscription at any time and **MUST return 404** when the app server sends to an expired one (RFC 8030 §7.3). Push services also use 410 (see §2).
- **Payload size:** the push service must not return 413 for bodies of 4096 bytes or fewer (RFC 8030 §7.2). With `aes128gcm` overhead, that leaves at most **3993 bytes of plaintext** (RFC 8291 §4).
- **Encryption (RFC 8291):** the content coding must be `aes128gcm`, with exactly one record. The inputs are the subscription's P-256 ECDH public key (`p256dh`) and its 16-byte `auth` secret. The subscription data must reach the app server over an authenticated, confidential channel. Header fields are not protected. The push service still sees timing, size and which server talks to which subscription; padding can hide the size (RFC 8291 §2.1, §4, §7; RFC 8030 §8.1). An empty body needs no encryption; Apple says the `Content-Encoding` header can then be omitted (see §3).
- **VAPID (RFC 8292):** the app server signs a JWT with ES256 (ECDSA P-256). `aud` must be the push resource's origin. `exp` must be no more than **24 hours** after the request (otherwise 403). `sub` is optional in the RFC (MAY; when present it SHOULD be a `mailto:` or `https:` URI). The `Authorization: vapid t=<jwt>, k=<key>` header carries the public key, which is the 65-byte uncompressed point, base64url-encoded. A subscription created with an `applicationServerKey` only accepts messages signed with the matching key (401 when VAPID is missing, 403 when it is invalid). **Rotating the VAPID key means every user agent must subscribe again** (§2–4.2).
- Without that key restriction, anyone holding the endpoint URL can send to it (RFC 8292 §1). This matches pilot-delivery.md's "sensitive capability URLs".

**What to store per subscription** (W3C `PushSubscription` / `PushSubscriptionJSON`): `endpoint`, `keys.p256dh`, `keys.auth`, and the nullable `expirationTime`. Because of RFC 8292 §4.2, the server also needs to know which VAPID public key the subscription was created with. The owning account and device are application data.

**When to delete one:**

- on 404 or 410 from the push service (RFC 8030 §7.3; vendor codes in §2);
- when `pushsubscriptionchange` replaces it; the new subscription has a different key pair (W3C Push API §10.4);
- when the user opts out or unsubscribes, or deletes their account;
- after `expirationTime`.

A 403 VAPID-key mismatch also means the subscription can no longer be used under the current key.

## 2. Push services and where they process data

The browser chooses the push service, not nunio. The endpoint origin is that service. W3C Push API §4 says the push service sees the timing, frequency and size of messages, and that "other than changing push services, which user agents may disallow", there is no known way around this.

| Browser                    | Push service                                                                       | Source                                                                                                                                                        | Processing location                                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome                     | Firebase Cloud Messaging; VAPID needs no Google or Firebase project                | [web.dev push FAQ](https://web.dev/articles/push-notifications-faq), "July 2016"                                                                              | [Firebase privacy page](https://firebase.google.com/support/privacy): unless a service offers location selection, Firebase "may process and store your data anywhere Google or its agents maintain facilities"; FCM is not listed among the services with location selection |
| Firefox                    | Mozilla autopush. Messages for offline devices are stored in Google Cloud Bigtable | [autopush architecture](https://mozilla-services.github.io/autopush-rs/architecture.html), "Storage Tables"                                                   | [Firefox Privacy Notice](https://www.mozilla.org/en-US/privacy/firefox/), "International transfers of data": "Mozilla (and our servers) are based in the United States"                                                                                                      |
| Safari (macOS, iOS/iPadOS) | Apple Push Notification service; allow `https://*.push.apple.com`                  | [Apple — Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) | Not stated in the docs read (see Unverified)                                                                                                                                                                                                                                 |

What each push service receives:

- **Always:** the endpoint (a per-subscription identifier), the VAPID public key and JWT including `sub`, the `TTL`, `Urgency` and `Topic` headers, the message size and timing, and the sending server's IP address.
- **With an encrypted payload:** only ciphertext. The push service cannot read the content without the browser-held keys (RFC 8291).
- **With an empty payload:** no content at all, only the metadata above.

Response codes:

- **Mozilla** ([autopush errors](https://mozilla-services.github.io/autopush-rs/errors.html)): 404 "should not be used again"; 410 "no longer valid"; 413 when the body exceeds 4028 characters; 429 when rate limited.
- **Apple:** 410 "device token has expired"; 413 above 4 KB; 429; 403 for authentication errors. Apple uses 404 for an invalid `:path`.

## 3. Apple Web Push on iOS/iPadOS

Sources: [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) (Feb 2023); [Apple developer docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers); [WebKit — Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/) (Mar 2025).

Verified:

- **Versions:** iOS/iPadOS 16.4 or later, and only for **Home Screen web apps**. On the Mac, Safari 16 on macOS 13 or later. No Apple Developer Program membership is needed (Apple docs, Overview).
- **Home Screen web app:** the site must serve a manifest whose `display` is `standalone` or `fullscreen`, and the user must add it through Share → "Add to Home Screen" (WebKit 2023).
- **Permission:** the request must come from direct user interaction. Apple says to call subscribe "immediately from the gesture's event handler".
- **Every push must show a notification:** "Safari doesn't support invisible push notifications… If you don't, Safari revokes the push notification permission for your site." Chrome requires `userVisibleOnly: true` for the same reason ([web.dev](https://web.dev/articles/push-notifications-subscribing-a-user), "userVisibleOnly options").
- **Server rules:**
  - TLS with SNI.
  - Apple stores an undelivered message for at most 30 days, depending on TTL, and limits how many it stores per offline device.
  - Do not refresh the JWT more often than once per hour.
  - `BadJwtToken` covers a `sub` that is not a URL or `mailto:` (so Apple effectively requires `sub`) and an `exp` more than one day ahead.
  - The `web-push` README adds that Safari rejects `https://localhost` subjects.
  - At most 100 unacknowledged pipelined requests over HTTP/1.1.
- **Focus:** notifications from iOS Home Screen web apps follow the user's Focus modes (WebKit 2023). This is separate from nunio's Quiet Hours.
- **Declarative Web Push** (iOS/iPadOS 18.4, macOS 15.5): a JSON payload with `"web_push": 8030` and a `notification` object is displayed without running JavaScript, and it is backwards compatible. The title and body travel inside the encrypted payload, so they must still be generic for nunio.

## 4. Libraries on the repo runtime

The runtime is Node in production for all apps ([ADR-0003](../adr/0003-stack-and-runtimes.md)). Root, `apps/api` and `apps/web` declare `"engines": { "node": ">=24 <25" }`, `.nvmrc` is `24`, and the worker image is `node:24-bookworm-slim`. `apps/api` and `apps/worker` are `"type": "module"`.

**`web-push`** ([repo](https://github.com/web-push-libs/web-push), [npm registry metadata](https://registry.npmjs.org/web-push)), checked 2026-11-09:

- The latest version is **4.0.0, published 2026-11-06**; the one before it was 3.6.7 (2024-01-16).
- 4.0.0 is ESM-only (`"type": "module"`, commit "feat: migrate to ESM-only (#961)"). It also refactored to classes (#966) and changed the CLI to `parseArgs` (#968).
- It declares `"engines": { "node": ">= 16" }` and uses `node:https` and Node crypto (`src/web-push-lib.js`). That suits Node 24 in `api` and `worker`, but not edge or WebCrypto-only runtimes.
- Dependencies: `jws`, `asn1.js`, `http_ece` 1.2.1, `https-proxy-agent`. License MPL-2.0.
- The repo is not archived, has 44 open issues, and its last push was 2026-11-09.
- There are no GitHub release notes for 4.x, and the package ships no types; `@types/web-push` latest is 3.6.4.
- The README supports `TTL`, `urgency`, `topic`, `timeout` and `contentEncoding` (`aes128gcm` by default). **The default TTL is four weeks** (`DEFAULT_TTL = 2419200` in source). Failed sends reject with a `WebPushError` that carries `statusCode`.

**WebCrypto alternatives** (npm metadata and the repos' READMEs):

- [`@block65/webcrypto-web-push`](https://github.com/block65/webcrypto-web-push): 2.0.0 (2026-09-03), `node >=22`, MIT, one dependency. It has Node and Cloudflare Workers examples and end-to-end tests "against real push services".
- [`@pushforge/builder`](https://github.com/draphy/pushforge): 2.0.5 (2026-04-23), `node >=20`, MIT, no dependencies.

## 5. Notification email on Scaleway TEM

Sources:

- [TEM FAQ](https://www.scaleway.com/en/docs/transactional-email/faq/), "Can I use your platform to send marketing emails?";
- [TEM anti-spam policy (PDF)](https://tem.s3.fr-par.scw.cloud/antispam_policy.pdf);
- [TEM capabilities and limits](https://www.scaleway.com/en/docs/transactional-email/reference-content/tem-capabilities-and-limits/) (reviewed 2025-10-29);
- [TEM blocklists](https://www.scaleway.com/en/docs/transactional-email/how-to/manage-blocklists/);
- [TEM API](https://www.scaleway.com/en/developers/api/transactional-email/) and the [Go SDK's generated types](https://github.com/scaleway/scaleway-sdk-go/blob/master/api/tem/v1alpha1/tem_sdk.go).

Verified:

- **Transactional only.** "You cannot use Transactional Email to send marketing emails." The policy defines a transactional email as sent to a single recipient, "triggered by events, interactions or preferences within a service or application rather than by a company's marketing campaign". Newsletters and mass mailings need another service.
- **Enforcement:** if Scaleway finds irregular use (a blocklisted domain, high bounce rates or complaints, judged "at its sole discretion"), it can **suspend the service and the account**, with no refund.
- **Quotas:** 10,000 emails per month by default (can be raised through support); 10 recipients per email; 2 MB per email through the API. Every recipient counts as one email. There has been no hourly quota since 2023-12-01. TEM runs only in `fr-par`.
- **Headers and fields:** the API takes `additional_headers` (key/value pairs; the documented example is `Reply-To`) and `send_before` ("maximum date to deliver the email", per the SDK). The docs read do not describe a built-in unsubscribe or List-Unsubscribe feature.
- **Blocklists:** addresses are blocklisted automatically when the mailbox is missing or full; manual entries need the Scale plan. Webhook event types include `email_delivered`, `email_dropped`, `email_spam`, `email_mailbox_not_found` and `email_blocklisted`.

**RFC 8058 one-click unsubscribe** ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058) §3–4):

- The message carries exactly one `List-Unsubscribe` header with one HTTPS URI, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- A valid **DKIM signature must cover both headers**.
- The URI must identify the recipient and list without cookies or auth, because the POST carries none.
- The endpoint must not answer with a redirect.

**Gmail** ([sender guidelines](https://support.google.com/a/answer/81126), [FAQ](https://support.google.com/a/answer/14229414)):

- All senders need SPF or DKIM, valid forward and reverse DNS, TLS, RFC 5322 format, and a spam rate below 0.3%.
- Senders of more than 5,000 messages per day also need SPF, DKIM, DMARC and From alignment, and "marketing messages and subscribed messages" must support one-click unsubscribe.
- The FAQ adds: "One-click unsubscribe is required only for marketing and promotional messages. Transactional messages are excluded."

**Yahoo** ([sender best practices](https://senders.yahooinc.com/best-practices/), [FAQ](https://senders.yahooinc.com/faqs/)):

- All senders need SPF or DKIM, a spam rate below 0.3%, valid DNS, and RFC 5321/5322 compliance.
- Bulk senders also need SPF, DKIM, DMARC (`p=none` or stricter), alignment, and one-click unsubscribe for "marketing and subscribed messages", honoured within 2 days. Yahoo publishes no volume threshold.
- One-click unsubscribe "does not apply to transactional messages". Yahoo will not decide which mail needs it and advises using a one-click option where complaints are high.

**Application to nunio:** an Intervention email is triggered by an event for one student, so it fits TEM's definition and is exempt from one-click unsubscribe. A daily Briefing is triggered by the student's own setting ("preferences" in TEM's wording). It is non-promotional, but it is the kind of recurring, opted-in mail Gmail and Yahoo may treat as "subscribed". Pilot volume is far below Gmail's 5,000 per day.

## 6. Conflicts with the constraints or with pilot-delivery.md

- **Quiet Hours must be enforced on the server.** Apple revokes push permission when a push arrives without a notification being shown, and Chrome requires `userVisibleOnly`. So the service worker cannot receive a push and suppress it during Quiet Hours. Messages must be held before sending.
- **`web-push`'s four-week default TTL** conflicts with "held messages go out only if still applicable". Without an explicit TTL, a push queued while the device is offline can show up weeks later (Apple caps this at 30 days).
- **EU hosting:** all three push services are picked by the browser. FCM may process anywhere; Mozilla's servers are in the US. nunio has no contract with any of them, so they cannot go through the processor DPA review the way ADR-0008 expects. The payload is end-to-end encrypted (or absent), but the endpoint and send metadata (timing, size, Topic) always reach them. ADR-0008 does not mention this channel.
- **Topic values are visible** to the push service. Readable topics (for example, a Course name) would leak personal content outside the encrypted payload.
- **One TEM account carries both kinds of mail.** If Scaleway suspended the account over notification email (say, complaints about Briefings), authentication email would stop as well (ADR-0013).
- **pilot-delivery.md:** nothing contradicts it. Its open item "verify device/browser setup requirements" is now answered for iOS: Home Screen install, manifest with `display: standalone` or `fullscreen`, iOS 16.4 or later, and a user gesture.

## Unverified

- Where Apple's push service (`*.push.apple.com`) processes and stores web push data, and in which region Mozilla runs autopush.
- Whether TEM accepts `List-Unsubscribe` and `List-Unsubscribe-Post` through `additional_headers`, and whether its DKIM signature covers them, as RFC 8058 requires. Needs a staging send with the raw headers inspected.
- The exact behaviour of TEM's `send_before`: is the email dropped once the date passes? Only the SDK comment describes it.
- Whether `@types/web-push` 3.6.4 matches the 4.0.0 API, and what else 4.0.0 changed beyond the commit titles (there are no release notes).
- Whether Scaleway would class a scheduled daily Briefing as transactional. The policy wording suggests yes, but Scaleway decides "at its sole discretion".
- Push delivery on the actual pilot devices and browsers.

## Implications for Phase 10 (proposals)

- **Send from the worker:** proposal: send push from the Temporal worker (Node 24), so held messages wait on durable timers. When Quiet Hours end, re-check that the Intervention still applies, then send.
- **TTL and Urgency:** proposal: set an explicit short `TTL` (hours, not weeks) tied to how long the message stays applicable, and `Urgency: low` for Briefings. Never rely on the library default.
- **Generic payloads:** proposal: send **empty pushes**, or a fixed generic payload. The service worker shows fixed text ("You have something new in nunio") that opens the Inbox. This keeps the push services down to metadata only and meets the generic-payload guard by construction. If a `Topic` is used, make it an opaque constant or a random value.
- **Subscription table:** proposal: store `endpoint`, `p256dh`, `auth`, `expirationTime`, VAPID key id, account and created-at. Delete rows on 404/410, on `pushsubscriptionchange`, on opt-out and on account deletion. Treat endpoints as secrets in logs.
- **VAPID key:** proposal: one long-lived key pair per environment, in the secret store. Set `sub` to a `mailto:` or `https:` contact (Apple requires it; not localhost). Reuse the JWT for 1–24 hours.
- **Library:** proposal: use `web-push` (the established Node library) and pin it exactly. Choose between 4.0.0 (ESM, three days old, no types) and 3.6.7 after a spike that sends to Chrome, Firefox and an iOS Home Screen app. `@block65/webcrypto-web-push` is the fallback if WebCrypto or bundled types matter.
- **iOS:** proposal: promise iOS push only to students who install nunio to the Home Screen. Show install guidance there instead of a permission prompt in Safari tabs.
- **Email:** proposal: keep notification email on TEM as transactional mail, one recipient per message, with no promotional content. Still add RFC 8058 headers and a visible link to notification settings on Briefing emails, since it is cheap and lowers complaint risk (pending the TEM header check above). Consider sending notifications from a separate subdomain or sender so complaints are tracked apart from authentication mail. Raise the 10,000 per month quota before the pilot if Briefings could exceed it.
- **ADR-0008:** proposal: record in an ADR-0008 amendment that browser push services are chosen by the user agent, receive only metadata and an encrypted or empty payload, and sit outside the processor DPA review.
