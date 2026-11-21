import { mutationOptions } from "@tanstack/react-query";
import { SignInAgainError } from "@/features/auth/sign-in-again";
import { ApiError, createApiClient } from "@/lib/api-client";

export function deletionMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async () => {
      const { response } = await createApiClient(apiOrigin).POST(
        "/api/me/deletion-request",
      );
      if (response.status === 202) return;
      if (response.status === 403) throw new SignInAgainError();
      throw new ApiError(
        response.status,
        "Die Löschung konnte nicht angefordert werden. Bitte versuche es erneut.",
      );
    },
  });
}
