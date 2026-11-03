"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface ListedSession {
  token: string;
  userAgent?: string | null;
  createdAt: Date;
}

export function SessionList({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const client = authClient(apiOrigin);
    void Promise.all([client.listSessions(), client.getSession()]).then(([listed, session]) => {
      if (listed.error) return setError("Could not load your sessions.");
      setSessions(listed.data);
      setCurrent(session.data?.session.token ?? null);
    });
  }, [apiOrigin, version]);

  async function revoke(token: string) {
    const result = await authClient(apiOrigin).revokeSession({ token });
    if (result.error) return setError("Could not sign out that session.");
    setVersion((v) => v + 1);
  }

  async function signOutEverywhere() {
    const result = await authClient(apiOrigin).revokeSessions();
    if (result.error) return setError("Could not sign out everywhere.");
    queryClient.clear();
    window.location.replace("/sign-in");
  }

  return (
    <>
      <ul>
        {sessions.map((session) => (
          <li key={session.token}>
            {session.userAgent ?? "Unknown device"}, signed in {new Date(session.createdAt).toLocaleString()}
            {session.token === current
              ? " (This device)"
              : <button type="button" onClick={() => revoke(session.token)}>Sign out</button>}
          </li>
        ))}
      </ul>
      <button type="button" onClick={signOutEverywhere}>Sign out everywhere</button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
