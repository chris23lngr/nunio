"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
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
import { useState } from "react";
import { Logo } from "@/components/logo";
import { useAppForm } from "@/lib/form";
import { CodeStep, sendSignInCode } from "./code-step";
import { PasskeyPrompt } from "./passkey-prompt";
import { shouldOfferPasskey } from "./passkeys";

export function SignUpScreen({
  apiOrigin,
  invitation,
  email,
}: {
  apiOrigin: string;
  invitation?: string;
  /** The invited address from the Invitation link; the student cannot change it. */
  email?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [offerPasskey, setOfferPasskey] = useState(false);
  const signInHref = invitation
    ? `/sign-in?invitation=${encodeURIComponent(invitation)}`
    : "/sign-in";

  function enterApp() {
    router.replace("/");
    router.refresh();
  }

  const form = useAppForm({
    defaultValues: {
      name: "",
      email: email ?? "",
      termsAccepted: false,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      const address = value.email.trim();
      const failure = await sendSignInCode(apiOrigin, address);
      if (failure) {
        setError(failure);
        return;
      }
      setCodeSentTo(address);
    },
  });

  return (
    <>
      <Logo />
      <h1 className="mt-5 text-2xl leading-8 font-medium">
        Willkommen bei nunio!
      </h1>
      <div className="mt-12 flex flex-col gap-4">
        <Button
          type="button"
          variant="outline"
          disabled
          className="w-full text-base-700"
        >
          <Image src="/microsoft.svg" width={16} height={16} alt="" />
          Mit Microsoft registrieren
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled
          className="w-full text-base-700"
        >
          <Image src="/google.png" width={16} height={16} alt="" />
          Mit Google registrieren
        </Button>
      </div>
      <div className="my-8 flex items-center gap-3 text-xs text-base-500">
        <span className="h-px flex-1 bg-base-200" />
        <span>ODER</span>
        <span className="h-px flex-1 bg-base-200" />
      </div>
      {!invitation ? (
        <p role="status" className="text-sm leading-5 text-base-600">
          Für die Registrierung brauchst du eine Einladung. Öffne den Link aus
          deiner Einladungs-E-Mail.
        </p>
      ) : offerPasskey ? (
        <PasskeyPrompt apiOrigin={apiOrigin} onDone={enterApp} />
      ) : codeSentTo ? (
        <CodeStep
          apiOrigin={apiOrigin}
          email={codeSentTo}
          name={form.getFieldValue("name").trim()}
          invitation={invitation}
          onSignedIn={async () => {
            if (await shouldOfferPasskey(apiOrigin)) setOfferPasskey(true);
            else enterApp();
          }}
          onBack={email ? undefined : () => setCodeSentTo(null)}
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
              name="name"
              validators={{
                onChange: ({ value }) =>
                  value.trim() ? undefined : "Bitte gib deinen Namen ein.",
              }}
            >
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="sign-up-name" className="leading-5">
                      Name
                    </FieldLabel>
                    <Input
                      id="sign-up-name"
                      name={field.name}
                      autoComplete="name"
                      placeholder="Max Mustermann"
                      required
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid ? "sign-up-name-error" : undefined
                      }
                    />
                    {invalid && (
                      <FieldError id="sign-up-name-error">
                        {field.state.meta.errors.join(" ")}
                      </FieldError>
                    )}
                  </Field>
                );
              }}
            </form.Field>
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
                    <FieldLabel htmlFor="sign-up-email" className="leading-5">
                      E-Mail
                    </FieldLabel>
                    <Input
                      id="sign-up-email"
                      name={field.name}
                      type="email"
                      autoComplete="email"
                      readOnly={!!email}
                      placeholder="name@example.com"
                      required
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid ? "sign-up-email-error" : undefined
                      }
                    />
                    {invalid && (
                      <FieldError id="sign-up-email-error">
                        {field.state.meta.errors.join(" ")}
                      </FieldError>
                    )}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field
              name="termsAccepted"
              validators={{
                onChange: ({ value }) =>
                  value
                    ? undefined
                    : "Bitte stimme den Allgemeinen Geschäftsbedingungen zu und bestätige, dass du die Datenschutzerklärung gelesen hast.",
              }}
            >
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="terms-accepted"
                        name={field.name}
                        className="mt-0.5"
                        required
                        checked={field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={invalid || undefined}
                        aria-describedby={invalid ? "terms-error" : undefined}
                      />
                      <FieldLabel
                        htmlFor="terms-accepted"
                        className="block leading-5 font-normal text-base-500"
                      >
                        Ich stimme den{" "}
                        <Link
                          href="/terms"
                          className="text-base-800 hover:text-primary-600 font-medium"
                        >
                          Allgemeinen Geschäftsbedingungen
                        </Link>{" "}
                        zu und bestätige, dass ich die{" "}
                        <Link
                          href="/privacy"
                          className="text-base-800 hover:text-primary-600 font-medium"
                        >
                          Datenschutzerklärung
                        </Link>{" "}
                        gelesen habe.
                      </FieldLabel>
                    </div>
                    {invalid && (
                      <FieldError id="terms-error">
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
          </FieldGroup>
          {error && <FieldError className="mt-4">{error}</FieldError>}
        </form>
      )}
      <p className="mt-8 text-sm text-base-500">
        Bereits ein Konto?{" "}
        <Link
          href={signInHref}
          className="rounded-sm text-primary-500 hover:text-primary-600 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
        >
          Hier anmelden
        </Link>
      </p>
    </>
  );
}
