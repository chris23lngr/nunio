# How university mailboxes accept IMAP and SMTP

Checked: 2026-11-25. Question: [#259](https://github.com/chris23lngr/nunio/issues/259), on map [#256](https://github.com/chris23lngr/nunio/issues/256) (Integrations v1: MCP connections and Email). This is research, not an accepted decision. No code was written. The only things run were a read-only probe of each server's advertised `CAPABILITY` (IMAP) and `EHLO` (SMTP) before login, from a German residential IP, and a read of the `imapflow@2.12.2` and `nodemailer@10.6.1` type definitions from npm.

## Finding and recommendation

**Email should be a password Connection first, with OAuth as a second auth method for Microsoft 365 (and Google) mailboxes. An OAuth-only Connection would fail almost every large German university today.**

1. **Large German universities run their own mail servers and accept a plain password over TLS.** All ten sampled (TUM, LMU, RWTH, KIT, Uni Hamburg, FU, HU, TU Berlin, Uni Köln, Uni Heidelberg) publish IMAP on 993 and SMTP submission on 587 or 465 with "normal password" login. None of their client guides mentions OAuth, app passwords or MFA for IMAP/SMTP. The servers that answered the probe advertise only password mechanisms (`PLAIN`, `LOGIN`, `NTLM`, `GSSAPI`, `CRAM-MD5`, `DIGEST-MD5`), none advertises `XOAUTH2` or `OAUTHBEARER`. Several are on-premises Exchange (TUM via LRZ, KIT, TU Berlin, RWTH, Heidelberg's Exchange); the rest are classic IMAP servers. Basic-auth deprecation in Exchange Online does not touch them.
2. **Microsoft 365 universities need OAuth, and in practice an admin consent per university.** Exchange Online has refused basic auth for IMAP since 2022–2023 and turns SMTP AUTH basic off by default at the end of December 2026. Under the tenant default ("Let Microsoft manage your consent settings"), students **cannot consent** to a third-party app asking for `IMAP.AccessAsUser.All`. Only six named mail clients (Thunderbird, Apple Mail, and others) are exempt. So nunio needs a verified-publisher, multi-tenant Entra app and a one-time admin consent in each university tenant that runs on M365. Seen so far: smaller institutions such as Uni Bamberg and HSBI. No large university in the sample is on M365 for student mail.
3. **Google Workspace** turned off password IMAP/SMTP on 2025-03-14 (app passwords still work). OAuth needs `https://mail.google.com/`, a **restricted** scope: a CASA security assessment every year, unless each university allowlists the app as an admin. No sampled German university uses Workspace for students. Defer it, and allow app passwords through the password Connection.
4. **Libraries:** `imapflow` + `nodemailer` cover both methods (`auth.pass` or `auth.accessToken`, with XOAUTH2/OAUTHBEARER picked automatically). Both fit short-lived worker Activities: connect, act, log out, with no IDLE. Build the MIME once, send it over SMTP, then `APPEND` the same bytes to Sent, except on servers that file their own copy (Exchange Online, Gmail).

What this implies for the Connection model:

- A Connection holds **host/port settings plus one secret**: a password (or app password), or an OAuth refresh token. Presets per university domain fill in the hosts. The password is a long-lived credential for the student's whole university account at most of these universities (the RWTH mail password is a separate, mail-only one). It needs nunio-managed encryption and immediate deletion on Disconnect, and the student must be told plainly what they are handing over.
- Background Runs work with both methods. A password needs no refresh. An OAuth refresh token (`offline_access`) is renewed in the Activity before connecting. A revoked or changed credential fails as `AUTHENTICATIONFAILED`. nunio should then mark the Connection broken, which Pauses dependent Agents, the way losing a Connection already does in `GLOSSARY.md`.
- Outbound IP: Heidelberg allows SMTP submission only from German IPs or over VPN. nunio's API (Vercel `fra1`) and worker (Render Frankfurt), per ADR-0008, should geolocate to Germany. Keep sending in Frankfurt. Verify each provider's egress IP geolocation before relying on it.

## Microsoft 365 / Exchange Online

| Fact | Source |
| --- | --- |
| "Basic authentication is now disabled in all tenants … no one (you or Microsoft support) can re-enable" it, for POP, IMAP, EWS, EAS and others. It "also prevents the use of app passwords". | [Deprecation of Basic authentication in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online) (updated 2026-07) |
| SMTP AUTH basic: unchanged until December 2026. At the **end of December 2026** it is disabled by default for existing tenants, though admins can re-enable it. New tenants have it unavailable. The final removal date will be announced in H2 2027. | [Exchange Team blog, 2026-01-27 (v3.0)](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835) |
| SMTP AUTH itself (any auth method) can be off org-wide or per mailbox (`SmtpClientAuthenticationDisabled`). It is off when Entra *security defaults* are on. Submission is on port 587. | [Enable or disable SMTP AUTH in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission) |
| Delegated scopes: `https://outlook.office.com/IMAP.AccessAsUser.All` and `https://outlook.office.com/SMTP.Send`, plus `offline_access` for refresh tokens. Auth code or device code flow. SASL is `XOAUTH2`: `base64("user=" + user + "^Aauth=Bearer " + token + "^A^A")`. | [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth) |
| App-only (client credentials) needs `IMAP.AccessAsApp`/`SMTP.SendAsApp`, admin consent per tenant, `New-ServicePrincipal` in Exchange PowerShell, and `Add-MailboxPermission` **per mailbox**. Not workable for a student-driven product. | same page |
| Default user consent policy ("Microsoft managed", the default for new tenants): users can consent to user-consentable delegated permissions **except** a list that includes `IMAP.AccessAsUser.All`, `POP.AccessAsUser.All`, `EWS.AccessAsUser.All`, `EAS.AccessAsUser.All` and Graph `Mail.*`. A separate default policy lets users consent to mail permissions only for Apple Mail, Spark, eM Client, Samsung/Android Mail and Thunderbird (by app ID). `SMTP.Send` is **not** on the exclusion list. | [Manage app consent policies](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies) (updated 2026-11-19) |
| Tenants can also turn user consent off altogether, or allow it only for verified publishers. Microsoft recommends "verified publisher" as the minimum. The admin consent workflow lets a user request approval. | [Configure how users consent to applications](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent) |
| SMTP AUTH submissions are stored in the sending mailbox's Sent Items. Limits: 3 concurrent submitting connections per mailbox, 30 messages/min, 10,000 recipients/day. | [SMTP Authenticated Submission throttling](https://learn.microsoft.com/en-us/troubleshoot/exchange/send-emails/smtp-submission-improvements) |
| Probe: `outlook.office365.com:993` advertises `AUTH=XOAUTH2 LOGINDISABLED`. `smtp.office365.com:587` advertises `LOGIN XOAUTH2`. | own probe, 2026-11-25 |

**What an M365 university must do for nunio:** a Global Administrator (or Cloud Application/Application Administrator for delegated grants) opens `https://login.microsoftonline.com/{tenant}/v2.0/adminconsent?client_id=…` or approves an admin-consent-workflow request, granting the delegated `IMAP.AccessAsUser.All`, `SMTP.Send` and `offline_access`. They must also leave SMTP AUTH enabled for students. No per-mailbox PowerShell is needed for delegated access. nunio must register a **multi-tenant** app, and should complete **publisher verification**, because tenants that allow user consent only for verified publishers (Microsoft's recommended minimum) treat an unverified app as admin-only. Conditional Access policies of the tenant (MFA, compliant device) apply at sign-in. *Not verified:* which roles exactly may grant the Exchange Online delegated scopes, and whether a given university's Conditional Access allows a web app at all. Both vary per tenant.

**M365 examples among German institutions:** HSBI (Hochschule Bielefeld) requires XOAUTH2 clients and uses `outlook.office365.com:993` and `smtp.office365.com:587`, with 2FA through Entra ([HSBI](https://www.hsbi.de/dvz/beschreibungen-it-services/e-mail-exchange-online)). Uni Bamberg puts student mail on M365 with a Shibboleth sign-in through the browser ([Uni Bamberg](https://www.uni-bamberg.de/its/dienstleistungen/mail/studium/m365/thunderbird/)). Neither is in the large-university sample.

## Google Workspace

| Fact | Source |
| --- | --- |
| Since 2025-03-14, "CalDAV, CardDAV, IMAP, SMTP, and POP will no longer work with legacy passwords", except **app passwords** (which need 2-Step Verification). | [Transition from less secure apps to OAuth](https://knowledge.workspace.google.com/admin/sync/transition-from-less-secure-apps-to-oauth) |
| IMAP/SMTP OAuth scope is `https://mail.google.com/`. SASL `XOAUTH2` (and `OAUTHBEARER`). | [OAuth 2.0 Mechanism](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol) |
| `https://mail.google.com/` is a **restricted** scope. Storing or transmitting its data on servers requires a security assessment. | [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) |
| Restricted-scope verification: brand verification, demo video, CASA assessment by an approved assessor, renewed at least every 12 months. Admin allowlisting waives brand verification, not app verification. | [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) |
| Gmail files messages sent through its SMTP into Sent by itself. Clients should not also save a copy. | [Gmail Help: IMAP client settings](https://support.google.com/mail/answer/78892) |

## German universities sampled

Each row comes from the university's (or its computing centre's) own setup page. The last column is the pre-login probe from 2026-11-25. "Not mentioned" means the official page says nothing about OAuth, app passwords or MFA for mail clients.

| University | Student address | IMAP (993, TLS) | SMTP submission | Login | Backend | OAuth / app pw / MFA for IMAP | Network limits | Probe: advertised auth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TU München | `…@mytum.de` / `@tum.de` | `xmail.mwn.de` | `postout.lrz.de` 587 STARTTLS / 465 | TUM-LRZ-Kennung + password | Exchange at LRZ | not mentioned | none mentioned | IMAP `PLAIN`; SMTP `PLAIN LOGIN` |
| LMU München | `…@campus.lmu.de` | `studlmu.lrz.de` | `postout.lrz.de` 587 / 465 | LRZ-Kennung or address + password | LRZ mail server | not mentioned | none mentioned | IMAP `PLAIN`; SMTP `PLAIN LOGIN` |
| RWTH Aachen | `…@rwth-aachen.de` | `mail.rwth-aachen.de` | same host, 587 STARTTLS | `ab123456@rwth-aachen.de` + **mail-specific password set in Selfservice** | Exchange (IMAP or Exchange) | not mentioned | none mentioned | IMAP `PLAIN`; SMTP `GSSAPI NTLM LOGIN` |
| KIT | `uxxxx@student.kit.edu` | `imap.kit.edu` | `smtp.kit.edu` 587 STARTTLS; auth always required from outside | address + KIT password; needs Send-As for sender | Exchange | not mentioned | port 25 unauthenticated only inside KIT | IMAP `PLAIN NTLM GSSAPI`; SMTP `NTLM LOGIN` |
| Uni Hamburg | `…@studium.uni-hamburg.de` | `public.uni-hamburg.de` | same host, 587 STARTTLS | B-Kennung + password | RRZ "Public" mail server | not mentioned | none mentioned | IMAP `PLAIN LOGIN`; SMTP `PLAIN LOGIN` |
| FU Berlin | `…@zedat.fu-berlin.de` | `mail.zedat.fu-berlin.de` ¹ | same host, 587 / 465 ¹ | account name + password | ZEDAT Unix mail | not mentioned | none mentioned | IMAP: no `AUTH=` (plain `LOGIN` command); SMTP `PLAIN LOGIN` |
| HU Berlin | `first.last@hu-berlin.de` | `mailbox.cms.hu-berlin.de` ² | `mailhost.cms.hu-berlin.de` 587 STARTTLS ² | HU account (short) + password | IMAP, "not Exchange" | not mentioned | none mentioned | IMAP `PLAIN`; SMTP `PLAIN LOGIN` |
| TU Berlin | `…@campus.tu-berlin.de` | `mail.tu-berlin.de` | same host, 587 STARTTLS | `<account>@tu-berlin.de` + password | Exchange | not mentioned (page from 2022) | none mentioned | IMAP `PLAIN NTLM GSSAPI`; SMTP `LOGIN` |
| Uni Köln | `…@smail.uni-koeln.de` | `imap.uni-koeln.de` | `smtp-auth.uni-koeln.de` 587/465/25, "accessible worldwide" | account name (not address) + password | ITCC mail server | not mentioned | unauthenticated `smtp.uni-koeln.de` only on campus | IMAP `DIGEST-MD5 CRAM-MD5 PLAIN NTLM`; SMTP `PLAIN LOGIN NTLM CRAM-MD5 DIGEST-MD5` |
| Uni Heidelberg | `…@stud.uni-heidelberg.de` | `imap.urz.uni-heidelberg.de` | `mail.urz.uni-heidelberg.de` 587 / 465 | Uni-ID + password | URZ mail server (Exchange also offered) | not mentioned | **SMTP only from devices in Germany or via VPN** ("derzeit, aus Sicherheitsgründen") | **not verified**: all Heidelberg hosts (incl. web) timed out from the probe IP |

¹ The FU's official service page confirms IMAP and SMTP access but not the hosts. Hosts and ports come from FU department wikis and an older ZEDAT page, and the probe confirms both hosts answer.
² The HU CMS pages are behind a bot challenge that could not be passed. Hosts come from the HU Mathematics IT page (updated 2026-11-20), and the probe confirms both hosts answer.

Sources: TUM [LRZ](https://doku.lrz.de/mailservice-fuer-beschaeftigte-und-studierende-der-tu-muenchen-4427202.html); LMU [LRZ](https://doku.lrz.de/mailservice-fuer-studierende-der-lmu-muenchen-campuslmu-4427203.html); RWTH [IT Center](https://help.itc.rwth-aachen.de/en/service/1jefzdccuvuch/article/f13903aeda4246e683bc9b32106fa078/) ("last changed on 11/06/2026"); KIT [SCC Senden](https://www.scc.kit.edu/dienste/9047.php) (2024-03-15), [SCC Thunderbird](https://www.scc.kit.edu/en/services/15552.php); Hamburg [RRZ students](https://www.rrz.uni-hamburg.de/services/e-mail/fuer-studierende.html) (2026-04-24), [RRZ IMAP guide PDF v4.4](https://www.rrz.uni-hamburg.de/services/e-mail/daten/anleitung-mail-client-imap-public-v4-4.pdf) (2020); FU [FUB-IT](https://www.it.fu-berlin.de/unsere-services/services-a-z/37519141/index.html), [MI wiki](https://www.mi.fu-berlin.de/w/Tec/ExchangeImap); HU [Mathematik IT](https://www2.mathematik.hu-berlin.de/it/index.php?seite=mail&lang=en); TU Berlin [ZECM](https://www.tu.berlin/en/campusmanagement/it-support/email-setting-up-a-personal-mailbox-in-thunderbird-windows) (2022-10-13); Köln [ITCC](https://itcc.uni-koeln.de/en/services/accounts-communication/e-mail/e-mail-client-synchronization) (2026-09-18); Heidelberg [URZ e-mail server](https://www.urz.uni-heidelberg.de/de/service-katalog/e-mail-und-groupware/e-mail-server), [IPR](https://www.ipr.uni-heidelberg.de/edv/email.html) (2024-05-24).

Observations:

- **No VPN requirement for IMAP or authenticated SMTP** at any sampled university. The only restriction found is Heidelberg's Germany-only SMTP.
- Several universities have campus-wide 2FA (KIT, Uni Hamburg link 2FA pages), but none of their mail-client guides applies it to IMAP/SMTP. If one later does, it would most likely add app passwords (as at RWTH, where the mail password is already separate), not OAuth for third parties. *Not verified:* any university's roadmap.
- On-premises servers should be assumed **not** to file a sent copy for SMTP submissions as Exchange Online does. The LRZ guide for TUM's Exchange tells Thunderbird users to pick "Gesendete Elemente" as the copy folder by hand, which implies the server does not. So nunio must `APPEND` to Sent there. *Not verified* per server.
- Faculties often run their own servers (LMU Informatik, KIT Informatik, TUM CIT). University-domain presets are a convenience, and manual host entry is still needed.

## Libraries

### `imapflow` 2.12.2 (MIT, Postal Systems)

| Fact | Source |
| --- | --- |
| `auth: { user, pass }` or `auth: { user, accessToken }`. With a token it prefers `OAUTHBEARER`, then `XOAUTH2`, whichever the server advertises. `loginMethod` can force `LOGIN`/`AUTH=PLAIN`. | `dist/esm/types.d.ts` `AuthOptions`; `dist/esm/commands/authenticate.js` |
| `append(path, content, flags?, idate?)` returns `{ destination, uid?, uidValidity? }`, where the UID is present when the server has `UIDPLUS`. Use `['\\Seen']`. | `dist/esm/imap-flow.d.ts`, `AppendResponseObject` |
| Sent folder detection: `specialUse` from `SPECIAL-USE`/`XLIST`, or a fallback by localized name. The `\Sent` list includes "gesendet", "gesendete", "gesendete elemente". | `dist/esm/special-use.js`; `ListResponse.specialUseSource` |
| IDLE starts automatically after `autoIdleDelay` (default 15 s) of inactivity. `disableAutoIdle: true` turns it off. Without server IDLE it polls with `missingIdleCommand` (default `NOOP`). | `types.d.ts` `ImapFlowOptions` |
| `await using client = new ImapFlow(...)` logs out on scope exit, even on a throw (Node ≥ 20.4). Timeouts: `connectionTimeout` 90 s, `greetingTimeout` 16 s, `socketTimeout` 5 min. | `imap-flow.d.ts` `[Symbol.asyncDispose]`; `types.d.ts` |
| An auth failure carries `authenticationFailed: true` (response code `AUTHENTICATIONFAILED`). | `dist/esm/errors.d.ts` |

### `nodemailer` 10.6.1 (MIT-0, ships its own TypeScript types)

| Fact | Source |
| --- | --- |
| SMTP auth is `{ user, pass }` or `{ type: 'OAuth2', user, accessToken }`. The built-in token helper can refresh with `clientId`/`clientSecret`/`refreshToken`/`accessUrl` (it defaults to Google's endpoint) or call a `provisionCallback(user, renew, cb)`. nunio should pass a token it refreshed itself. | `dist/cjs/xoauth2/index.d.ts`, `smtp-connection/index.d.ts` |
| Threading: `inReplyTo` and `references` become headers of the root node. `messageId` can be set. | `dist/cjs/mail-composer/index.d.ts` `MailComposerOptions` |
| `MailComposer(...).compile().build()` returns the raw RFC 5322 `Buffer`. `sendMail({ raw, envelope })` sends prebuilt bytes. | `mail-composer/index.d.ts`, `mime-node/index.d.ts` `build()` |
| Without `pool: true`, each `sendMail` opens and closes its own connection. | `smtp-pool/index.d.ts`; README |

Threading rule (RFC 5322 §3.6.4): a reply sets `In-Reply-To` to the parent's `Message-ID` and `References` to the parent's `References` (or `In-Reply-To`) plus the parent's `Message-ID`. Subject gets "Re: ". nunio should read `Message-ID`/`References` of the parent with `imapflow` and pass them to `nodemailer`.

### Send path in a worker Activity

1. Build the message once with `MailComposer`, with nunio's own `Message-ID` (e.g. `<uuid@nunio.app>`), and keep the bytes. That `Message-ID` also identifies the outside write when its result is unknown.
2. `sendMail({ raw, envelope })` over SMTP with the Connection's credential.
3. Unless the provider files its own copy (Exchange Online, Gmail: decided by host), `append(sentPath, raw, ['\\Seen'])`. A failed append after a successful send is a warning, not a failed Action. Never resend.
4. A timeout before the SMTP `250` leaves the send Unconfirmed, as the map's "Durability of outside writes" note expects. Before any retry, search Sent for the `Message-ID`, which works only where a Sent copy exists.

### IDLE vs. polling

The map makes reading **on demand** (tools in Chats and Runs), so v1 needs no live connection. Each read tool call connects, does `STATUS`/`SEARCH`/`FETCH`, and logs out, with `disableAutoIdle: true`. "New mail since the last Run" works without IDLE: store `UIDVALIDITY` and `UIDNEXT` per folder and fetch `UID n:*` next time. IDLE would mean one long-lived connection per student and folder, which Temporal Activities and Exchange's per-mailbox connection limits do not suit. If push is ever needed, it belongs in a separate long-running service, not in Activities. *Not verified:* each sampled server's concurrent-connection limit per account.

## Not verified

- Heidelberg's current IMAP/SMTP state (no host reachable from the probe IP), and whether the Germany-only rule still applies.
- FU and HU hosts on their central IT pages (taken from department pages, confirmed reachable by the probe).
- `SPECIAL-USE` support: it is announced only after login, so the pre-login probe cannot show it.
- Which German universities beyond the sample (e.g. Bamberg, HSBI, other Hochschulen) are on M365 or Workspace, and their tenants' consent and Conditional Access settings.
- Whether `SMTP.Send` alone is user-consentable in practice when `IMAP.AccessAsUser.All` in the same request is not. Assume one admin consent covers both.
