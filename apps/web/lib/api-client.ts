import { createApiClient as createTransport } from "@nunio/api-client";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Keep HTTP transport shared; web-specific session handling belongs here. */
export function createApiClient(apiOrigin: string) {
  const client = createTransport(apiOrigin);
  client.use({
    onResponse({ response }) {
      if (response.status === 401) throw new ApiError(401, "Your session has expired. Please sign in again.");
    },
  });
  return client;
}
