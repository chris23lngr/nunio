import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { isPublic } from "./email/servers.js";

/**
 * A fetch that reaches only a vendor on the public internet, for OAuth and MCP requests. Outside INTEGRATION_FAKES it
 * speaks https only, so tokens, codes and verifiers never travel in the clear. It refuses every connection unless
 * each address is public: a host name is resolved inside the connector, so the address checked is the address used
 * (no DNS rebinding), and an IP address is checked there too. It never follows a redirect. `timeoutMs` bounds
 * connecting, and by default the wait for headers and between body chunks; `allowed` is a test seam. `destroy`
 * closes every connection it opened, cutting any request still under way.
 */
export function publicFetch(
  fakes: boolean,
  {
    timeoutMs,
    headersTimeoutMs = timeoutMs,
    bodyTimeoutMs = timeoutMs,
    allowed = isPublic,
    purpose,
  }: {
    timeoutMs: number;
    /** The longest wait for a response's headers. */
    headersTimeoutMs?: number;
    /** The longest wait between body chunks; 0 waits as long as it takes, as an event stream must. */
    bodyTimeoutMs?: number;
    allowed?: (address: string) => boolean;
    /** What the requests are for, in errors: "OAuth" or "MCP". */
    purpose: string;
  },
): PublicFetch {
  // A wrapper rather than globalThis.fetch itself, which the SDK would swap for its own guarded fetch.
  if (fakes)
    return Object.assign(
      ((input, init) => fetch(input, init)) as typeof fetch,
      { destroy: async () => {} },
    );
  const refused = (host: string) =>
    new Error(`${purpose} host ${host} is not public`);
  const connector = buildConnector({
    timeout: timeoutMs,
    lookup: (hostname, options, callback) =>
      dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, []);
        if (!addresses.length || !addresses.every((a) => allowed(a.address)))
          return callback(refused(hostname), []);
        if (options.all) return callback(null, addresses);
        const [first] = addresses;
        (callback as (e: null, address: string, family: number) => void)(
          null,
          first!.address,
          first!.family,
        );
      }),
  });
  const dispatcher = new Agent({
    headersTimeout: headersTimeoutMs,
    bodyTimeout: bodyTimeoutMs,
    // Every connection, every hop: an IP address is never looked up, so it is checked here.
    connect: (options, callback) => {
      const address = options.hostname.replace(/^\[|\]$/g, "");
      if (isIP(address) && !allowed(address))
        return callback(refused(options.hostname), null);
      connector(options, callback);
    },
  });
  const guarded = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== "https:")
      throw new Error(`${purpose} requests use https only`);
    if (init?.redirect === "follow")
      throw new Error(`${purpose} requests don't follow redirects`);
    return undiciFetch(input as never, {
      ...(init as object),
      redirect: init?.redirect ?? "error",
      dispatcher,
    });
  }) as unknown as typeof fetch;
  return Object.assign(guarded, { destroy: () => dispatcher.destroy() });
}

/** A fetch that reaches only the public internet, and closes its connections when destroyed. */
export type PublicFetch = typeof fetch & { destroy(): Promise<void> };
