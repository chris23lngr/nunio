"use client";

import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const create = (apiOrigin: string) =>
  createAuthClient({ baseURL: apiOrigin, plugins: [emailOTPClient()] });

// Share browser session notifications; never share an auth client between server requests.
const browserClients = new Map<string, ReturnType<typeof create>>();

export function authClient(apiOrigin: string) {
  if (typeof window === "undefined") return create(apiOrigin);
  let client = browserClients.get(apiOrigin);
  if (!client) {
    client = create(apiOrigin);
    browserClients.set(apiOrigin, client);
  }
  return client;
}
