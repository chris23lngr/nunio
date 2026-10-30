"use client";

import { createApiClient } from "@nunio/api-client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function DeletionForm({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setError(null);
    const { response } = await createApiClient(apiOrigin).POST("/api/me/deletion-request", { body: { password } });
    if (response.status === 202) return router.replace("/sign-in?deletion=requested");
    setError(response.status === 403 ? "That password is incorrect." : "Could not request deletion. Please try again.");
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
