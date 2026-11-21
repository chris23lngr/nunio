import { queryOptions } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export interface SecurityPasskey {
  id: string;
  name?: string | null;
  createdAt: string | Date;
  /** nunio's own column, set on each passkey sign-in. */
  lastUsedAt?: string | Date | null;
}

export function passkeyQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "passkeys"],
    queryFn: async ({ signal }) => {
      const result = await authClient(apiOrigin).passkey.listUserPasskeys({
        fetchOptions: { signal },
      });
      if (result.error)
        throw new ApiError(
          result.error.status,
          "Deine Passkeys konnten nicht geladen werden.",
        );
      return (result.data ?? []) as SecurityPasskey[];
    },
  });
}
