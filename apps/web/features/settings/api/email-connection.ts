import type { paths } from "@nunio/api-client";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@/lib/api-client";

type Json<T> = T extends { content: { "application/json": infer B } }
  ? B
  : never;
type TestRoute = paths["/api/me/connections/email/test"]["post"];
type ConnectRoute = paths["/api/me/connections/email"]["post"];

export type EmailDiscovery = Json<
  paths["/api/me/connections/email/discover"]["post"]["responses"][200]
>;
export type EmailLogin = Json<TestRoute["requestBody"]>;
export type MailFolder = Json<TestRoute["responses"][200]>["folders"][number];
/** Why nunio refused the mailbox; nothing was stored. */
export type MailboxRefusal = Json<TestRoute["responses"][422]>;

export class MailboxRefused extends Error {
  constructor(readonly refusal: MailboxRefusal) {
    super(`Mailbox refused: ${refusal.error}`);
    this.name = "MailboxRefused";
  }
}

/** Why the test or connect route refused, as the dialog shows it; a refused mailbox keeps its reason. */
function refusedWith(status: number, error: unknown, fallback: string) {
  if (status === 422 && error)
    return new MailboxRefused(error as MailboxRefusal);
  if (status === 429)
    return new ApiError(
      status,
      "Zu viele Anmeldeversuche. Versuch es in einer Viertelstunde noch einmal.",
    );
  if (status === 403)
    return new ApiError(
      status,
      "Ohne aktiven Pilotzugang kann nunio keine E-Mail verbinden.",
    );
  return new ApiError(status, fallback);
}

/** What nunio knows about an address's mail servers. */
export function emailDiscoveryQuery(apiOrigin: string, address: string) {
  return queryOptions({
    queryKey: [apiOrigin, "email-discovery", address],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/connections/email/discover",
        { body: { address }, signal },
      );
      if (!result.data) throw new Error("Could not recognise the address.");
      return result.data;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Tests reading and sending; nothing is sent or stored. */
export function emailTestMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (login: EmailLogin) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/connections/email/test",
        { body: login },
      );
      if (result.data) return result.data.folders;
      throw refusedWith(
        result.response.status,
        result.error,
        "Die Anmeldung konnte nicht geprüft werden. Bitte versuche es erneut.",
      );
    },
  });
}

/** Tests again and saves the Connection with the chosen folders. */
export function emailConnectMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (login: Json<ConnectRoute["requestBody"]>) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/connections/email",
        { body: login },
      );
      if (result.data) return result.data.connection;
      throw refusedWith(
        result.response.status,
        result.error,
        result.response.status === 409
          ? "Du hast schon eine E-Mail verbunden."
          : "Die Verbindung konnte nicht gespeichert werden. Bitte versuche es erneut.",
      );
    },
  });
}
