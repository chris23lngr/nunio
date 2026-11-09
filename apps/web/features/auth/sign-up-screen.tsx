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
import { useState } from "react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { useAppForm } from "@/lib/form";

export function SignUpScreen({
  apiOrigin,
  invitation,
}: {
  apiOrigin: string;
  invitation?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [sendingVerification, setSendingVerification] = useState(false);
  const signInHref = invitation
    ? `/sign-in?invitation=${encodeURIComponent(invitation)}`
    : "/sign-in";

  const form = useAppForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      termsAccepted: false,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setNotice(null);
      setPendingEmail(null);
      try {
        const result = await authClient(apiOrigin).signUp.email({
          name: value.name.trim(),
          email: value.email,
          password: value.password,
          callbackURL: `${window.location.origin}/sign-in`,
          fetchOptions: { headers: { "x-invitation-token": invitation ?? "" } },
        });
        if (result.error) {
          setError(
            result.error.message ??
              "Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.",
          );
          return;
        }
        setPendingEmail(value.email);
        setNotice(
          "Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Danach kannst du dich anmelden.",
        );
      } catch {
        setError(
          "Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.",
        );
      }
    },
  });

  async function resendVerification() {
    if (!pendingEmail) return;
    setSendingVerification(true);
    try {
      const result = await authClient(apiOrigin).sendVerificationEmail({
        email: pendingEmail,
        callbackURL: `${window.location.origin}/sign-in`,
      });
      if (result.error) {
        setError(
          result.error.message ??
            "Die Bestätigungs-E-Mail konnte nicht gesendet werden.",
        );
        return;
      }
      setError(null);
      setNotice(
        "Falls eine Bestätigung erforderlich ist, wurde eine neue E-Mail gesendet.",
      );
    } catch {
      setError(
        "Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es erneut.",
      );
    } finally {
      setSendingVerification(false);
    }
  }

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
                    onChange={(event) => field.handleChange(event.target.value)}
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
                    placeholder="name@example.com"
                    required
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
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
            name="password"
            validators={{
              onChange: ({ value }) =>
                value.length >= 8 && value.length <= 128
                  ? undefined
                  : "Verwende zwischen 8 und 128 Zeichen.",
            }}
          >
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="sign-up-password" className="leading-5">
                    Passwort
                  </FieldLabel>
                  <Input
                    id="sign-up-password"
                    name={field.name}
                    type="password"
                    autoComplete="new-password"
                    placeholder="**************"
                    minLength={8}
                    maxLength={128}
                    required
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? "sign-up-password-error" : undefined
                    }
                  />
                  {invalid && (
                    <FieldError id="sign-up-password-error">
                      {field.state.meta.errors.join(" ")}
                    </FieldError>
                  )}
                </Field>
              );
            }}
          </form.Field>
          <form.Field
            name="confirmPassword"
            validators={{
              onChangeListenTo: ["password"],
              onChange: ({ value, fieldApi }) =>
                value === fieldApi.form.getFieldValue("password") && value
                  ? undefined
                  : "Die Passwörter stimmen nicht überein.",
            }}
          >
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel
                    htmlFor="sign-up-confirm-password"
                    className="leading-5"
                  >
                    Passwort bestätigen
                  </FieldLabel>
                  <Input
                    id="sign-up-confirm-password"
                    name={field.name}
                    type="password"
                    autoComplete="new-password"
                    placeholder="**************"
                    required
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? "sign-up-confirm-error" : undefined
                    }
                  />
                  {invalid && (
                    <FieldError id="sign-up-confirm-error">
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
                      onCheckedChange={(checked) => field.handleChange(checked)}
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
                {isSubmitting
                  ? "Registrierung läuft…"
                  : "Mit E-Mail registrieren"}
              </Button>
            )}
          </form.Subscribe>
        </FieldGroup>
        {error && <FieldError className="mt-4">{error}</FieldError>}
        {notice && (
          <p role="status" className="mt-4 text-sm text-base-600">
            {notice}
          </p>
        )}
        {pendingEmail && (
          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full"
            disabled={sendingVerification}
            onClick={resendVerification}
          >
            Bestätigungs-E-Mail erneut senden
          </Button>
        )}
      </form>
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
