"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { useAppForm } from "@/lib/form";
import { CodeStep, sendSignInCode } from "./code-step";
import { PasskeyPrompt } from "./passkey-prompt";
import { shouldOfferPasskey, supportsPasskeys } from "./passkeys";

const passkeyFailed =
  "Die Anmeldung mit Passkey hat nicht geklappt. Versuche es erneut oder melde dich mit einem Code an.";

export function SignInScreen({
  apiOrigin,
  invitation,
  initialNotice,
}: {
  apiOrigin: string;
  /** Kept for the link to registration; accounts are created only there. */
  invitation?: string;
  initialNotice?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [offerPasskey, setOfferPasskey] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const signUpHref = invitation
    ? `/sign-up?invitation=${encodeURIComponent(invitation)}`
    : "/sign-up";

  function enterApp() {
    router.replace("/");
    router.refresh();
  }

  // Lets the browser suggest a saved passkey right in the address field.
  useEffect(() => {
    if (!supportsPasskeys()) return;
    setPasskeys(true);
    let current = true;
    void window.PublicKeyCredential.isConditionalMediationAvailable?.()
      .then(async (available) => {
        if (!available || !current) return;
        const result = await authClient(apiOrigin).signIn.passkey({
          autoFill: true,
        });
        if (current && !result?.error) enterApp();
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: Autofill starts once per visit.
  }, [apiOrigin]);

  async function signInWithPasskey() {
    setError(null);
    setNotice(null);
    const result = await authClient(apiOrigin)
      .signIn.passkey()
      .catch(() => ({ error: true }));
    if (result?.error) {
      setError(passkeyFailed);
      return;
    }
    enterApp();
  }

  const form = useAppForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      setNotice(null);
      const email = value.email.trim();
      const failure = await sendSignInCode(apiOrigin, email);
      if (failure) {
        setError(failure);
        return;
      }
      setCodeSentTo(email);
    },
  });

  return (
    <>
      <Logo />
      <h1 className="mt-5 text-2xl leading-8 font-medium">
        Willkommen zurück!
      </h1>
      <div className="mt-12 flex flex-col gap-4">
        <Button
          type="button"
          variant="outline"
          disabled
          className="w-full text-base-700"
        >
          <Image src="/microsoft.svg" width={16} height={16} alt="" />
          Mit Microsoft anmelden
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled
          className="w-full text-base-700"
        >
          <Image src="/google.png" width={16} height={16} alt="" />
          Mit Google anmelden
        </Button>
      </div>
      <div className="my-8 flex items-center gap-3 text-xs text-base-500">
        <span className="h-px flex-1 bg-base-200" />
        <span>ODER</span>
        <span className="h-px flex-1 bg-base-200" />
      </div>
      {offerPasskey ? (
        <PasskeyPrompt apiOrigin={apiOrigin} onDone={enterApp} />
      ) : codeSentTo ? (
        <CodeStep
          apiOrigin={apiOrigin}
          email={codeSentTo}
          onSignedIn={async () => {
            if (await shouldOfferPasskey(apiOrigin)) setOfferPasskey(true);
            else enterApp();
          }}
          onBack={() => setCodeSentTo(null)}
        />
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup className="gap-6">
            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) =>
                  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
                    ? undefined
                    : "Bitte gib eine gültige E-Mail-Adresse ein.",
              }}
            >
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="sign-in-email" className="leading-5">
                      E-Mail
                    </FieldLabel>
                    <Input
                      id="sign-in-email"
                      name={field.name}
                      type="email"
                      autoComplete="username webauthn"
                      placeholder="name@example.com"
                      required
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid ? "sign-in-email-error" : undefined
                      }
                    />
                    {invalid && (
                      <FieldError id="sign-in-email-error">
                        {field.state.meta.errors.join(" ")}
                      </FieldError>
                    )}
                  </Field>
                );
              }}
            </form.Field>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  className="h-8 w-full"
                  disabled={!canSubmit || isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? "Code wird gesendet…" : "Code senden"}
                </Button>
              )}
            </form.Subscribe>
            {passkeys && (
              <Button
                type="button"
                variant="outline"
                className="-mt-3 w-full"
                onClick={() => void signInWithPasskey()}
              >
                Mit Passkey anmelden
              </Button>
            )}
          </FieldGroup>
          {error && <FieldError className="mt-4">{error}</FieldError>}
          {notice && (
            <p role="status" className="mt-4 text-sm text-base-600">
              {notice}
            </p>
          )}
        </form>
      )}
      <p className="mt-8 text-sm text-base-500">
        Noch kein Konto?{" "}
        <Link
          href={signUpHref}
          className="rounded-sm text-primary-500 hover:text-primary-600 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
        >
          Hier registrieren
        </Link>
      </p>
    </>
  );
}
