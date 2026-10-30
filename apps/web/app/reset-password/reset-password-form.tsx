"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ apiOrigin, token }: { apiOrigin: string; token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient(apiOrigin).resetPassword({
      token,
      newPassword: String(form.get("password")),
    });
    if (result.error) return setError(result.error.message ?? "Could not reset password. Request a new link from sign in.");
    router.replace("/sign-in?reset=success");
  }

  return (
    <form method="post" onSubmit={submit}>
      <label>
        New password <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
      </label>
      <button type="submit">Reset password</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
