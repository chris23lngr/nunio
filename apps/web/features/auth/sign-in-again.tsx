"use client";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nunio/ui/components/dialog/dialog";
import { useEffect, useState } from "react";
import { CodeStep, sendSignInCode } from "./code-step";

/** The API refused a sensitive action because the session is older than ten minutes (ADR-0027). */
export class SignInAgainError extends Error {
  constructor() {
    super("Bitte bestätige mit einem Code, dass du es bist.");
  }
}

/** Emails the student a code and signs them in again with it, for a sensitive action. */
export function SignInAgain({
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

/** Confirms the student with a code before `onSignedIn` repeats the refused action. */
export function SignInAgainDialog({
  apiOrigin,
  email,
  open,
  description,
  onClose,
  onSignedIn,
}: {
  apiOrigin: string;
  email: string | null;
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
              onSignedIn={onSignedIn}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
