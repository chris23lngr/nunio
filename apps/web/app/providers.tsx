"use client";

import { useRouter } from "next/navigation";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(() => createQueryClient(() => {
    router.replace("/sign-in");
    router.refresh();
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
