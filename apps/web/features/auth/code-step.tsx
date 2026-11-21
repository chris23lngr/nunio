"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@nunio/ui/components/field/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@nunio/ui/components/input-otp/input-otp";
import { useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

const resendWaitSeconds = 60;
const tooManyRequests =
  "Zu viele Versuche. Warte einen Moment und versuche es erneut.";
const sendFailed =
  "Der Code konnte nicht gesendet werden. Bitte versuche es erneut.";

/** Emails a sign-in code; returns why it failed, or null. The answer is the same whether or not a code was sent (ADR-0027). */
export async function sendSignInCode(
  apiOrigin: string,
  email: string,
): Promise<string | null> {
  try {
    const result = await authClient(apiOrigin).emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    if (!result.error) return null;
    return result.error.status === 429 ? tooManyRequests : sendFailed;
  } catch {
    return sendFailed;
  }
}

function refusal(error: { status?: number; code?: string }): string {
  if (error.status === 429) return tooManyRequests;
  switch (error.code) {
    case "INVALID_OTP":
      return "Der Code stimmt nicht. Prüfe ihn oder fordere einen neuen an.";
    case "OTP_EXPIRED":
      return "Der Code ist abgelaufen. Fordere einen neuen an.";
    case "TOO_MANY_ATTEMPTS":
      return "Zu viele falsche Versuche. Fordere einen neuen Code an.";
    case "INVITATION_REQUIRED":
      return "Deine Einladung ist ungültig, abgelaufen oder wurde schon verwendet.";
    case "DELETION_PENDING":
      return "Für dieses Konto wurde die Löschung angefordert.";
    default:
      return "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.";
  }
}

/**
 * Asks for the code just emailed to `email` and signs in with it once all six digits are there.
 * A new account takes `name` and the Invitation token.
 */
export function CodeStep({
  apiOrigin,
  email,
  name,
  invitation,
  onSignedIn,
  onBack,
}: {
  apiOrigin: string;
  email: string;
  name?: string;
  invitation?: string;
  onSignedIn: () => void | Promise<void>;
  onBack?: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAt, setResendAt] = useState(
    () => Date.now() + resendWaitSeconds * 1000,
  );
  const [now, setNow] = useState(() => Date.now());
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function submit(otp: string) {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authClient(apiOrigin).signIn.emailOtp({
        email,
        otp,
        ...(name && { name }),
        ...(invitation && {
          fetchOptions: { headers: { "x-invitation-token": invitation } },
        }),
      });
      if (!result.error) {
        await onSignedIn();
        return;
      }
      setError(refusal(result.error));
    } catch {
      setError("Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.");
    } finally {
      setSubmitting(false);
    }
    setCode("");
    input.current?.focus();
  }

  async function resend() {
    setResending(true);
    setError(null);
    setNotice(null);
    const failure = await sendSignInCode(apiOrigin, email);
    setResending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setCode("");
    setNow(Date.now());
    setResendAt(Date.now() + resendWaitSeconds * 1000);
    setNotice("Wir haben dir einen neuen Code geschickt.");
  }

  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-5 text-base-600">
        Wir haben einen 6-stelligen Code an{" "}
        <span className="font-medium text-base-800">{email}</span> geschickt,
        falls zu dieser Adresse ein Konto oder eine Einladung gehört.
      </p>
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={id} className="leading-5">
          Anmeldecode
        </FieldLabel>
        <InputOTP
          ref={input}
          id={id}
          autoFocus
          maxLength={6}
          pattern="^\d+$"
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={(value: string) => void submit(value)}
          disabled={submitting}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                aria-invalid={!!error || undefined}
                className="size-9 text-base"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </Field>
      {notice && (
        <p role="status" className="text-sm text-base-600">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={wait > 0 || resending || submitting}
          onClick={() => void resend()}
        >
          {wait > 0 ? `Neuen Code senden (${wait} s)` : "Neuen Code senden"}
        </Button>
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={onBack}
          >
            Andere E-Mail
          </Button>
        )}
      </div>
    </div>
  );
}
