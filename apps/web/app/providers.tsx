"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createQueryClient } from "@/lib/query-client";

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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
