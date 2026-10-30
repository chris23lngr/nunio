"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const client = authClient(apiOrigin);
    const result =
      intent === "sign-up"
        ? await client.signUp.email({ name: String(form.get("name")), email, password })
        : await client.signIn.email({ email, password });
    if (result.error) return setError(result.error.message ?? "Sign-in failed");
    router.replace("/");
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
      <button type="submit" value="sign-up">
        Sign up
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
