import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { createQueryClient } from "@/lib/query-client";

export function TestProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient(() => {}));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
