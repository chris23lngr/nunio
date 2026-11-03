"use client";

import { createApiClient } from "@nunio/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

export function DeletionForm({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setError(null);
    const { response } = await createApiClient(apiOrigin).POST("/api/me/deletion-request", { body: { password } });
    if (response.status === 202) {
      queryClient.clear();
      window.location.replace("/sign-in?deletion=requested");
      return;
    }
    setError(response.status === 403
      ? "That password is incorrect."
      : response.status === 429
        ? "Too many attempts. Wait a moment and try again."
        : "Could not request deletion. Please try again.");
  }

  return (
    <form onSubmit={submit}>
      <p>Deletion signs you out everywhere and cannot be undone. nunio completes it manually.</p>
      <label>
        Password <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit">Request account deletion</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
