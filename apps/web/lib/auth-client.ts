"use client";

import { createAuthClient } from "better-auth/react";

// Share browser session notifications; never share an auth client between server requests.
const browserClients = new Map<string, ReturnType<typeof createAuthClient>>();

export function authClient(apiOrigin: string) {
  if (typeof window === "undefined") return createAuthClient({ baseURL: apiOrigin });
  let client = browserClients.get(apiOrigin);
  if (!client) {
    client = createAuthClient({ baseURL: apiOrigin });
    browserClients.set(apiOrigin, client);
  }
  return client;
}
