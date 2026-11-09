import { queryOptions } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export type SecuritySession = ReturnType<
  typeof authClient
>["$Infer"]["Session"]["session"];

export function sessionQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "security-sessions"],
    queryFn: async ({ signal }) => {
      const client = authClient(apiOrigin);
      const [listed, current] = await Promise.all([
        client.listSessions({ fetchOptions: { signal } }),
        client.getSession({ fetchOptions: { signal } }),
      ]);
      const error = listed.error ?? current.error;
      if (error)
        throw new ApiError(
          error.status,
          "Deine Sitzungen konnten nicht geladen werden.",
        );
      return {
        sessions: listed.data ?? [],
        currentToken: current.data?.session.token ?? null,
      };
    },
  });
}
