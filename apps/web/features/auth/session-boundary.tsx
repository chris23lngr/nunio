"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

/** Discard both the browser cache and server-rendered identity when the session changes. */
export function SessionBoundary({ apiOrigin, initialSessionId, children }: {
  apiOrigin: string;
  initialSessionId: string | null;
  children: ReactNode;
}) {
  const [auth] = useState(() => authClient(apiOrigin));
  const session = auth.useSession();
  const queryClient = useQueryClient();
  const currentId = session.data?.user.emailVerified ? session.data.session.id : null;
  const changed = !session.isPending && !session.error && currentId !== initialSessionId;

  useEffect(() => {
    if (!changed) return;
    queryClient.clear();
    window.location.replace(currentId ? (initialSessionId ? window.location.href : "/") : "/sign-in");
  }, [changed, currentId, initialSessionId, queryClient]);

  return changed ? null : children;
}
