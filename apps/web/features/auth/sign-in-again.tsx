"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nunio/ui/components/dialog/dialog";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { CodeStep, sendSignInCode } from "./code-step";
import { supportsPasskeys } from "./passkeys";

/** The API refused a sensitive action because the session is older than ten minutes (ADR-0027). */
export class SignInAgainError extends Error {
  constructor() {
    super("Bitte bestätige, dass du es bist.");
  }
}

/**
 * Signs the student in again for a sensitive action: with one of their passkeys where the browser can,
 * otherwise with an emailed code (ADR-0027).
 */
export function SignInAgain({
  apiOrigin,
  email,
  hasPasskey = false,
  onSignedIn,
}: {
  apiOrigin: string;
  email: string;
  hasPasskey?: boolean;
  onSignedIn: () => void;
}) {
  const [withCode, setWithCode] = useState(
    () => !hasPasskey || !supportsPasskeys(),
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmWithPasskey() {
    setConfirming(true);
    setError(null);
    // With a session, the API offers only this student's passkeys.
    const result = await authClient(apiOrigin)
      .signIn.passkey()
      .catch(() => ({ error: true }));
    setConfirming(false);
    if (result?.error) {
      setError(
        "Die Bestätigung mit Passkey hat nicht geklappt. Versuche es erneut oder nutze einen Code.",
      );
      return;
    }
    onSignedIn();
  }

  if (withCode)
    return (
      <EmailedCode
        apiOrigin={apiOrigin}
        email={email}
        onSignedIn={onSignedIn}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={confirming}
          aria-busy={confirming}
          onClick={() => void confirmWithPasskey()}
        >
          Mit Passkey bestätigen
        </Button>
        <Button
          variant="outline"
          disabled={confirming}
          onClick={() => setWithCode(true)}
        >
          Code per E-Mail senden
        </Button>
      </div>
    </div>
  );
}

/** Emails the student a code and signs them in again with it. */
function EmailedCode({
  apiOrigin,
  email,
  onSignedIn,
}: {
  apiOrigin: string;
  email: string;
  onSignedIn: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void sendSignInCode(apiOrigin, email).then((failure) => {
      if (!current) return;
      if (failure) setError(failure);
      else setSent(true);
    });
    return () => {
      current = false;
    };
  }, [apiOrigin, email]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive-700">
        {error}
      </p>
    );
  if (!sent)
    return (
      <p role="status" className="text-sm text-base-500">
        Code wird gesendet…
      </p>
    );
  return (
    <CodeStep apiOrigin={apiOrigin} email={email} onSignedIn={onSignedIn} />
  );
}

/** Confirms the student before `onSignedIn` repeats the refused action. */
export function SignInAgainDialog({
  apiOrigin,
  email,
  hasPasskey,
  open,
  description,
  onClose,
  onSignedIn,
}: {
  apiOrigin: string;
  email: string | null;
  hasPasskey: boolean;
  open: boolean;
  description: string;
  onClose: () => void;
  onSignedIn: () => void;
}) {
  return (
    <Dialog
      open={open && !!email}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bestätige, dass du es bist</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {email && (
            <SignInAgain
              apiOrigin={apiOrigin}
              email={email}
              hasPasskey={hasPasskey}
              onSignedIn={onSignedIn}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
