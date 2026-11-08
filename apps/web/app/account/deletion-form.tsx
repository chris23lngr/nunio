"use client";

import { useAppForm } from "@/lib/form";
import { useRouter } from "next/navigation";
import { createApiClient } from "@nunio/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function DeletionForm({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value: { password } }) => {
      setError(null);
      const { response } = await createApiClient(apiOrigin).POST("/api/me/deletion-request", { body: { password } });
      if (response.status === 202) {
        queryClient.clear();
        router.replace("/sign-in?deletion=requested");
        router.refresh();
        return;
      }
      setError(response.status === 403
        ? "That password is incorrect."
        : response.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "Could not request deletion. Please try again.");
    },
  });

  return (
    <form onSubmit={event => { event.preventDefault(); void form.handleSubmit(); }}>
      <p>Deletion signs you out everywhere and cannot be undone. nunio completes it manually.</p>
      <form.AppField name="password">
        {field => <field.TextField label="Password" type="password" autoComplete="current-password" required />}
      </form.AppField>
      <form.AppForm><form.SubmitButton>Request account deletion</form.SubmitButton></form.AppForm>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
