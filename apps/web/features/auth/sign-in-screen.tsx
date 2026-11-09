"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { useAppForm } from "@/lib/form";

export function SignInScreen({ apiOrigin, invitation, initialNotice, initialError }: {
  apiOrigin: string; invitation?: string; initialNotice?: string; initialError?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [sendingVerification, setSendingVerification] = useState(false);
  const signUpHref = invitation ? `/sign-up?invitation=${encodeURIComponent(invitation)}` : "/sign-up";

  const form = useAppForm({
    defaultValues: { email: "", password: "", rememberMe: false },
    onSubmit: async ({ value }) => {
      setError(null);
      setNotice(null);
      setPendingEmail(null);
      try {
        const result = await authClient(apiOrigin).signIn.email(value);
        if (result.error) {
          if (result.error.code === "EMAIL_NOT_VERIFIED") setPendingEmail(value.email);
          setError(result.error.message ?? "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.");
          return;
        }
        router.replace("/");
        router.refresh();
      } catch {
        setError("Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.");
      }
    },
  });

  async function resendVerification() {
    if (!pendingEmail) return;
    setSendingVerification(true);
    try {
      const result = await authClient(apiOrigin).sendVerificationEmail({
        email: pendingEmail, callbackURL: `${window.location.origin}/sign-in`,
      });
      if (result.error) {
        setError(result.error.message ?? "Die Bestätigungs-E-Mail konnte nicht gesendet werden.");
        return;
      }
      setError(null);
      setNotice("Falls eine Bestätigung erforderlich ist, wurde eine neue E-Mail gesendet.");
    } catch {
      setError("Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es erneut.");
    } finally {
      setSendingVerification(false);
    }
  }

  return (
    <>
      <Logo />
      <h1 className="mt-5 text-2xl leading-8 font-medium">Willkommen zurück!</h1>
      <div className="mt-12 flex flex-col gap-4">
        <Button type="button" variant="outline" disabled className="w-full text-base-700">
          <Image src="/microsoft.svg" width={16} height={16} alt="" />Mit Microsoft anmelden
        </Button>
        <Button type="button" variant="outline" disabled className="w-full text-base-700">
          <Image src="/google.png" width={16} height={16} alt="" />Mit Google anmelden
        </Button>
      </div>
      <div className="my-8 flex items-center gap-3 text-xs text-base-500">
        <span className="h-px flex-1 bg-base-200" /><span>ODER</span><span className="h-px flex-1 bg-base-200" />
      </div>
      <form noValidate onSubmit={event => { event.preventDefault(); void form.handleSubmit(); }}>
        <FieldGroup className="gap-6">
          <form.Field name="email" validators={{
            onChange: ({ value }) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : "Bitte gib eine gültige E-Mail-Adresse ein.",
          }}>
            {field => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="sign-in-email" className="leading-5">E-Mail</FieldLabel>
                  <Input id="sign-in-email" name={field.name} type="email" autoComplete="email" placeholder="name@example.com" required
                    value={field.state.value} onChange={event => field.handleChange(event.target.value)} onBlur={field.handleBlur}
                    aria-invalid={invalid || undefined} aria-describedby={invalid ? "sign-in-email-error" : undefined} />
                  {invalid && <FieldError id="sign-in-email-error">{field.state.meta.errors.join(" ")}</FieldError>}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="password" validators={{ onChange: ({ value }) => value ? undefined : "Bitte gib dein Passwort ein." }}>
            {field => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="sign-in-password" className="leading-5">Passwort</FieldLabel>
                    <Link href="/forgot-password" className="rounded-sm text-sm text-primary-500 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500">Passwort vergessen?</Link>
                  </div>
                  <Input id="sign-in-password" name={field.name} type="password" autoComplete="current-password" placeholder="**************" required
                    value={field.state.value} onChange={event => field.handleChange(event.target.value)} onBlur={field.handleBlur}
                    aria-invalid={invalid || undefined} aria-describedby={invalid ? "sign-in-password-error" : undefined} />
                  {invalid && <FieldError id="sign-in-password-error">{field.state.meta.errors.join(" ")}</FieldError>}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="rememberMe">
            {field => (
              <Field orientation="horizontal" className="gap-3">
                <Checkbox id="remember-me" name={field.name} checked={field.state.value} onCheckedChange={checked => field.handleChange(checked)} onBlur={field.handleBlur} />
                <FieldLabel htmlFor="remember-me" className="leading-5 font-normal">Für 30 Tage angemeldet bleiben</FieldLabel>
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={state => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" className="h-8 w-full" disabled={!canSubmit || isSubmitting} aria-busy={isSubmitting}>
                {isSubmitting ? "Anmeldung läuft…" : "Mit E-Mail anmelden"}
              </Button>
            )}
          </form.Subscribe>
        </FieldGroup>
        {error && <FieldError className="mt-4">{error}</FieldError>}
        {notice && <p role="status" className="mt-4 text-sm text-base-600">{notice}</p>}
        {pendingEmail && <Button type="button" variant="outline" className="mt-4 w-full" disabled={sendingVerification} onClick={resendVerification}>Bestätigungs-E-Mail erneut senden</Button>}
      </form>
      <p className="mt-8 text-sm text-base-500">
        Noch kein Konto? <Link href={signUpHref} className="rounded-sm text-primary-500 hover:text-primary-600 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500">Hier registrieren</Link>
      </p>
    </>
  );
}
