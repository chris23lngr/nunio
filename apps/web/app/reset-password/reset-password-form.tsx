"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAppForm } from "@/lib/form";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ apiOrigin, token }: { apiOrigin: string; token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await authClient(apiOrigin).resetPassword({
        token,
        newPassword: value.password,
      });
      if (result.error) return setError(result.error.message ?? "Could not reset password. Request a new link from sign in.");
      router.replace("/sign-in?reset=success");
    },
  });

  return (
    <form method="post" onSubmit={event => { event.preventDefault(); void form.handleSubmit(); }}>
      <form.AppField name="password" validators={{
        onChange: ({ value }) => value.length < 8 || value.length > 128 ? "Use between 8 and 128 characters." : undefined,
      }}>
        {field => <field.TextField label="New password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />}
      </form.AppField>
      <form.AppForm><form.SubmitButton>Reset password</form.SubmitButton></form.AppForm>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
