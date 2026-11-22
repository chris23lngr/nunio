"use client";

import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createQueryClient } from "@/lib/query-client";

const Leaving = createContext<RefObject<boolean> | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // One 401 leaves the page. The page stays mounted until sign-in lands and reads what was cleared again;
  // handling those 401s too cleared and restarted the navigation, so it could never land (#225).
  const leaving = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each page the student reaches re-arms the exit.
  useEffect(() => {
    leaving.current = false;
  }, [pathname]);
  const [client] = useState(() => {
    const client = createQueryClient(() => {
      if (leaving.current) return;
      leaving.current = true;
      client.clear();
      router.replace("/sign-in");
      router.refresh();
    });
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      <Leaving value={leaving}>{children}</Leaving>
    </QueryClientProvider>
  );
}

/**
 * Leave the page on purpose (sign-out, deletion). It claims the page's exit before clearing, so the 401s
 * the cleared page reads cannot send the student to a bare /sign-in instead (#247).
 */
export function useLeave() {
  const leaving = useContext(Leaving);
  const queryClient = useQueryClient();
  const router = useRouter();
  return (to: string, { refresh = true } = {}) => {
    if (leaving) leaving.current = true;
    queryClient.clear();
    router.replace(to);
    if (refresh) router.refresh();
  };
}
