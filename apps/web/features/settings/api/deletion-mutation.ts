import { mutationOptions } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@/lib/api-client";

export function deletionMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (password: string) => {
      const { response } = await createApiClient(apiOrigin).POST(
        "/api/me/deletion-request",
        { body: { password } },
      );
      if (response.status !== 202)
        throw new ApiError(
          response.status,
          response.status === 403
            ? "Das Passwort ist nicht korrekt."
            : response.status === 429
              ? "Zu viele Versuche. Warte einen Moment und versuche es erneut."
              : "Die Löschung konnte nicht angefordert werden. Bitte versuche es erneut.",
        );
    },
  });
}
