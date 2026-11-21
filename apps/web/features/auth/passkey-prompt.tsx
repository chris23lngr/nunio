"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { passkeyName } from "./passkeys";

/** Offers a passkey after a code sign-in; every choice ends in the app. */
export function PasskeyPrompt({
  apiOrigin,
  onDone,
}: {
  apiOrigin: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await authClient(apiOrigin)
      .passkey.addPasskey({ name: passkeyName() })
      .catch(() => ({ error: true }));
    setBusy(false);
    if (result?.error) {
      setError(
        "Der Passkey konnte nicht eingerichtet werden. Versuche es erneut oder später in den Einstellungen.",
      );
      return;
    }
    onDone();
  }

  async function dismiss() {
    setBusy(true);
    await authClient(apiOrigin)
      .updateUser({ passkeyPromptDismissed: true })
      .catch(() => undefined);
    onDone();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg leading-7 font-medium text-base-800">
          Passkey einrichten?
        </h2>
        <p className="mt-1 text-sm leading-5 text-base-600">
          Mit einem Passkey meldest du dich auf diesem Gerät per Face ID,
          Fingerabdruck oder Geräte-PIN an, ohne auf einen Code zu warten.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-700">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button
          className="h-8 w-full"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void add()}
        >
          Passkey einrichten
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={onDone}
        >
          Später
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          Nicht mehr fragen
        </Button>
      </div>
    </div>
  );
}
