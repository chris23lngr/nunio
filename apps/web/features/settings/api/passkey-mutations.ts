import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { passkeyName } from "@/features/auth/passkeys";
import { SignInAgainError } from "@/features/auth/sign-in-again";
import { ApiError } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { passkeyQueries } from "./passkey-queries";

export function addPasskeyMutation(
  apiOrigin: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await authClient(apiOrigin).passkey.addPasskey({
        name: passkeyName(),
      });
      const error = result?.error as { code?: string; status?: number } | null;
      if (error?.code === "SESSION_NOT_FRESH") throw new SignInAgainError();
      if (error)
        throw new ApiError(
          error.status ?? 400,
          "Der Passkey konnte nicht hinzugefügt werden. Bitte versuche es erneut.",
        );
    },
    onSuccess: () => queryClient.invalidateQueries(passkeyQueries(apiOrigin)),
  });
}

export function deletePasskeyMutation(
  apiOrigin: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const result = await authClient(apiOrigin).passkey.deletePasskey({ id });
      if (result.error?.code === "SESSION_NOT_FRESH")
        throw new SignInAgainError();
      if (result.error)
        throw new ApiError(
          result.error.status,
          "Der Passkey konnte nicht gelöscht werden. Bitte versuche es erneut.",
        );
    },
    onSuccess: () => queryClient.invalidateQueries(passkeyQueries(apiOrigin)),
  });
}
