import { mutationOptions } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export function revokeSessionMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (token: string) => {
      const result = await authClient(apiOrigin).revokeSession({ token });
      if (result.error)
        throw new ApiError(
          result.error.status,
          "Diese Sitzung konnte nicht abgemeldet werden. Bitte versuche es erneut.",
        );
    },
  });
}

export function signOutMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (everywhere: boolean) => {
      const client = authClient(apiOrigin);
      const result = everywhere
        ? await client.revokeSessions()
        : await client.signOut();
      if (result.error)
        throw new ApiError(
          result.error.status,
          "Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.",
        );
    },
  });
}
