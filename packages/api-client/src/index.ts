import createClient from "openapi-fetch";
import type { paths } from "./schema.js";

export type { paths };

/** Typed client for the nunio API. Sends cookies, because auth lives on api.<domain> (ADR-0005). */
export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl, credentials: "include" });
}
