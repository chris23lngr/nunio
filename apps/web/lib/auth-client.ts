"use client";

import { createAuthClient } from "better-auth/react";

export function authClient(apiOrigin: string) {
  return createAuthClient({ baseURL: apiOrigin });
}
