---

## status: accepted

# Email codes and passkeys replace passwords

Students signed in with an email address and password. Passwords can be reused, guessed and phished, and their reset flow is a second way in. The founder decided on 2026-11-21 to remove them. Better Auth's support for the alternatives is checked in [Passwordless sign-in with Better Auth](../research/passwordless-auth-better-auth.md).

- **No passwords.** Password sign-in, sign-up, reset, verification and change are all disabled, including the routes Better Auth keeps mounted after `emailAndPassword` is turned off. A migration deletes the stored `credential` rows. Existing students sign in with an email code next time, without notice. Their existing sessions stay valid until they expire.
- **The email code is the base method.** Every student can always sign in with a 6-digit code sent to their address. It is valid for 10 minutes and allows 3 wrong guesses. A new code can be requested after 60 seconds and makes the previous one invalid. The email holds only the code, never a sign-in link. Each address may receive at most 5 codes and make at most 10 wrong guesses per hour, counted in Postgres across API instances, on top of Better Auth's limits per IP.
- **Passkeys are optional.** A student can add any number of passkeys and delete any of them, including the last. Signing in with a passkey requires user verification (biometrics or a PIN). The relying party is the app's host in each environment (`app.nunio.app`, `app.staging.nunio.app`), so passkeys never cross between environments. A student cannot turn email codes off.
- **The mailbox is the root of trust.** Whoever controls a student's mailbox can sign in as them and add a passkey. We accept this. It already held with password reset, and MFA stays deferred.
- **Invitations still gate accounts.** A code is sent only to an address with a valid, unaccepted Invitation or an existing account. For any other address the response is the same and nothing is sent, so the form does not reveal who has an account. Entering the code creates the account with a verified address, which activates the Pilot entitlement. Claiming the Invitation and creating the account commit together.
- **Sensitive actions need a recent sign-in.** Requesting deletion, signing out everywhere, and adding or deleting a passkey require a session created within the last 10 minutes. Otherwise the student signs in again with a passkey or a code. Adding a passkey sends the student an email that names the device and time, without a link.
- **Sessions last 30 days.** There is no "stay signed in" choice.

## Considered Options

- **Keep passwords as a fallback.** It adds no security once email codes are always available, and keeps credential stuffing and the reset flow as attack surface.
- **Passkeys required, codes only for recovery.** Stronger, but during the pilot every device or browser problem would reach the founder as support.
- **Sign-in links instead of codes.** A link opens on the device that received the email, mail scanners can consume it, and phishing emails look the same.
- **Email codes as the base, passkeys optional** (chosen).
