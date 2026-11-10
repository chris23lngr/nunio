import { createApiClient as createTransport } from "@nunio/api-client";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Keep HTTP transport shared; web-specific session handling belongs here. */
export function createApiClient(apiOrigin: string) {
  const client = createTransport(apiOrigin);
  client.use({
    onResponse({ response }) {
      if (response.status === 401)
        throw new ApiError(
          401,
          "Your session has expired. Please sign in again.",
        );
    },
  });
  return client;
}

/** SDK streaming requests use the same session-expiry boundary as JSON requests. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401)
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  return response;
}
