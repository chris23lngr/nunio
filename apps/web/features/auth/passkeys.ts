"use client";

import { sessionDevice } from "@/features/settings/session-device";
import { authClient } from "@/lib/auth-client";

export function supportsPasskeys(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

/** Names a new passkey after this device and browser, e.g. "macOS – Safari". */
export function passkeyName(): string {
  const device = sessionDevice(navigator.userAgent);
  return device.browser ? `${device.name} – ${device.browser}` : device.name;
}

/** Whether to offer a passkey after a code sign-in: none yet, not declined for good, and the browser can (ADR-0027). */
export async function shouldOfferPasskey(apiOrigin: string): Promise<boolean> {
  if (!supportsPasskeys()) return false;
  try {
    const client = authClient(apiOrigin);
    const [passkeys, session] = await Promise.all([
      client.passkey.listUserPasskeys(),
      client.getSession(),
    ]);
    return (
      !passkeys.error &&
      (passkeys.data ?? []).length === 0 &&
      !session.data?.user.passkeyPromptDismissed
    );
  } catch {
    return false;
  }
}
