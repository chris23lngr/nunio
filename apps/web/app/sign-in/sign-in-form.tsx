"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { useAppForm } from "@/lib/form";
import { authClient } from "@/lib/auth-client";

function appURL(path: string): string {
  return `${window.location.origin}${path}`;
}

export function SignInForm({ apiOrigin, invitation, initialNotice, initialError }: {
  apiOrigin: string; invitation?: string; initialNotice?: string; initialError?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);

  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmitMeta: { intent: "sign-in" as "sign-in" | "sign-up" },
    onSubmit: async ({ value, meta: { intent } }) => {
      const { email, password } = value;
      const client = authClient(apiOrigin);
      setError(null);
      setNotice(null);
      const result =
        intent === "sign-up"
          ? await client.signUp.email({
              name: value.name, email, password,
              callbackURL: appURL("/sign-in"),
              fetchOptions: { headers: { "x-invitation-token": invitation ?? "" } },
            })
          : await client.signIn.email({ email, password });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") setPendingEmail(email);
        return setError(result.error.message ?? "Sign-in failed");
      }
      if (intent === "sign-up") {
        setPendingEmail(email);
        setNotice("Check your email to verify your account, then sign in.");
        return;
      }
      router.replace("/");
      router.refresh();
    },
  });

  async function resendVerification() {
    if (!pendingEmail) return;
    const result = await authClient(apiOrigin).sendVerificationEmail({
      email: pendingEmail,
      callbackURL: appURL("/sign-in"),
    });
    if (result.error) return setError(result.error.message ?? "Could not send verification email");
    setError(null);
    setNotice("If verification is needed, a new email has been sent.");
  }

  async function requestPasswordReset(event: MouseEvent<HTMLButtonElement>) {
    const email = event.currentTarget.form!.elements.namedItem("email") as HTMLInputElement;
    if (!email.reportValidity()) return;
    setError(null);
    setNotice(null);
    const result = await authClient(apiOrigin).requestPasswordReset({
      email: form.getFieldValue("email"),
      redirectTo: appURL("/reset-password"),
    });
    if (result.error) return setError("Could not request a password reset. Please try again.");
    setNotice("If an account exists for that email address, check your email for a reset link.");
  }

  return (
    <form onSubmit={event => {
      event.preventDefault();
      const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "sign-up" ? "sign-up" : "sign-in";
      void form.handleSubmit({ intent });
    }}>
      <form.AppField name="name">
        {field => <field.TextField label="Name" autoComplete="name" />}
      </form.AppField>
      <form.AppField name="email">
        {field => <field.TextField label="Email" type="email" autoComplete="email" required />}
      </form.AppField>
      <form.AppField name="password">
        {field => <field.TextField label="Password" type="password" required />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton value="sign-in">Sign in</form.SubmitButton>
        {invitation && <form.SubmitButton value="sign-up">Sign up</form.SubmitButton>}
      </form.AppForm>
      {pendingEmail && <button type="button" onClick={resendVerification}>Resend verification email</button>}
      <button type="button" onClick={requestPasswordReset}>Forgot password?</button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
