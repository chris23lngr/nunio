"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type MouseEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ apiOrigin, invitation, verificationError, passwordReset }: {
  apiOrigin: string; invitation?: string; verificationError?: boolean; passwordReset?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(verificationError
    ? "That verification link could not be used. Sign in to request a new one."
    : null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(passwordReset
    ? "Your password has been reset. Sign in with your new password."
    : null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const client = authClient(apiOrigin);
    setError(null);
    setNotice(null);
    const result =
      intent === "sign-up"
        ? await client.signUp.email({
            name: String(form.get("name")), email, password,
            callbackURL: `${window.location.origin}/sign-in`,
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
  }

  async function resendVerification() {
    if (!pendingEmail) return;
    const result = await authClient(apiOrigin).sendVerificationEmail({
      email: pendingEmail,
      callbackURL: `${window.location.origin}/sign-in`,
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
      email: email.value,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (result.error) return setError("Could not request a password reset. Please try again.");
    setNotice("If an account exists for that email address, check your email for a reset link.");
  }

  return (
    <form onSubmit={submit}>
      <label>
        Name <input name="name" autoComplete="name" />
      </label>
      <label>
        Email <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password <input name="password" type="password" required />
      </label>
      <button type="submit" value="sign-in">
        Sign in
      </button>
      {invitation && <button type="submit" value="sign-up">
        Sign up
      </button>}
      {pendingEmail && <button type="button" onClick={resendVerification}>Resend verification email</button>}
      <button type="button" onClick={requestPasswordReset}>Forgot password?</button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
