"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

/** Discard both the browser cache and server-rendered identity when the session changes. */
export function SessionBoundary({
  apiOrigin,
  initialSessionId,
  children,
}: {
  apiOrigin: string;
  initialSessionId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [auth] = useState(() => authClient(apiOrigin));
  const session = auth.useSession();
  const { refetch } = session;
  const queryClient = useQueryClient();
  const currentId = session.data?.user.emailVerified
    ? session.data.session.id
    : null;
  const changed =
    !session.isPending && !session.error && currentId !== initialSessionId;

  useEffect(() => {
    void refetch();
  }, [initialSessionId, refetch]);

  useEffect(() => {
    if (!changed) return;
    queryClient.clear();
    if (!currentId) router.replace("/sign-in");
    router.refresh();
  }, [changed, currentId, initialSessionId, queryClient, router]);

  // Keep Next's route outlet mounted while its server payload is refreshed.
  return <div hidden={changed}>{children}</div>;
}
