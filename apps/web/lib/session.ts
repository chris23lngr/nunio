import { headers } from "next/headers";

export interface Session {
  session: { id: string };
  user: { id: string; name: string; email: string; emailVerified: boolean };
}

/** The public API origin, e.g. `https://api.nunio.app` (ADR-0005). */
export function apiOrigin(): string {
  const origin = process.env.API_ORIGIN;
  if (!origin) throw new Error("API_ORIGIN is not set");
  return origin;
}

/** Looks the session up on the API by forwarding the browser's cookie; never trusts the cookie alone. */
export async function getSession(): Promise<Session | null> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;
  const res = await fetch(`${apiOrigin()}/api/auth/get-session`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const session = (await res.json()) as Session | null;
  return session?.user.emailVerified ? session : null;
}
