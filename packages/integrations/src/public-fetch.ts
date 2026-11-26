import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { isPublic } from "./email/servers.js";

/**
 * A fetch that reaches only a vendor on the public internet, for OAuth and MCP requests. Outside INTEGRATION_FAKES it
 * speaks https only, so tokens, codes and verifiers never travel in the clear. It refuses every connection unless
 * each address is public: a host name is resolved inside the connector, so the address checked is the address used
 * (no DNS rebinding), and an IP address is checked there too. It never follows a redirect. `timeoutMs` bounds
 * connecting, waiting for headers and the wait between body chunks; `allowed` is a test seam.
 */
export function publicFetch(
  fakes: boolean,
  {
    timeoutMs,
    allowed = isPublic,
    what,
  }: {
    timeoutMs: number;
    allowed?: (address: string) => boolean;
    /** What the requests are for, in errors: "OAuth" or "MCP". */
    what: string;
  },
): typeof fetch {
  // A wrapper rather than globalThis.fetch itself, which the SDK would swap for its own guarded fetch.
  if (fakes) return (input, init) => fetch(input, init);
  const refused = (host: string) =>
    new Error(`${what} host ${host} is not public`);
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
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    // Every connection, every hop: an IP address is never looked up, so it is checked here.
    connect: (options, callback) => {
      const address = options.hostname.replace(/^\[|\]$/g, "");
      if (isIP(address) && !allowed(address))
        return callback(refused(options.hostname), null);
      connector(options, callback);
    },
  });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== "https:")
      throw new Error(`${what} requests use https only`);
    if (init?.redirect === "follow")
      throw new Error(`${what} requests don't follow redirects`);
    return undiciFetch(input as never, {
      ...(init as object),
      redirect: init?.redirect ?? "error",
      dispatcher,
    });
  }) as unknown as typeof fetch;
}
