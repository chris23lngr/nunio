import { mutationOptions } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@/lib/api-client";

/** Starts connecting an OAuth Integration: the vendor's sign-in page to send the student to. */
export function oauthStartMutation(
  apiOrigin: string,
  integration: { key: string; name: string },
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/connections/{integrationKey}/oauth",
        { params: { path: { integrationKey: integration.key } } },
      );
      if (result.data) return result.data.authorizationUrl;
      const { status } = result.response;
      const error = (result.error as { error?: string } | undefined)?.error;
      if (status === 409)
        throw new ApiError(
          status,
          `Du hast ${integration.name} schon verbunden.`,
        );
      if (status === 403)
        throw new ApiError(
          status,
          error === "deletion_pending"
            ? "Für dieses Konto wurde die Löschung angefordert."
            : `Ohne aktiven Pilotzugang kann nunio ${integration.name} nicht verbinden.`,
        );
      throw new ApiError(
        status,
        `nunio konnte die Anmeldung bei ${integration.name} nicht starten. Bitte versuche es später erneut.`,
      );
    },
  });
}
