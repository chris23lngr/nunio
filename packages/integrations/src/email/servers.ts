import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIPv4 } from "node:net";

/** How nunio speaks TLS on a mail port: TLS from the first byte, or STARTTLS before any login. */
export type MailTls = "implicit" | "starttls";

const ports: Record<"imap" | "smtp", Record<number, MailTls>> = {
  imap: { 993: "implicit", 143: "starttls" },
  smtp: { 465: "implicit", 587: "starttls" },
};

/**
 * TLS is always required: implicit TLS on 993 (IMAP) and 465 (SMTP), STARTTLS on 143 and 587. Any other port is
 * refused (null), except under INTEGRATION_FAKES, where the fakes' own ports speak implicit TLS.
 */
export function mailTls(
  protocol: "imap" | "smtp",
  port: number,
  { fakes }: { fakes: boolean },
): MailTls | null {
  return ports[protocol][port] ?? (fakes ? "implicit" : null);
}

/** A mail host nunio won't connect to: it doesn't resolve, or not only to addresses on the public internet. */
export class MailServerRefused extends Error {
  constructor(readonly host: string) {
    super(`Mail server ${host} is refused`);
    this.name = "MailServerRefused";
  }
}

/** Addresses that aren't on the public internet: private, loopback, link-local, shared, reserved and the like. */
const nonPublic = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  nonPublic.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  nonPublic.addSubnet(network, prefix, "ipv6");

function isPublic(address: string): boolean {
  // An IPv4-mapped address is checked as IPv4; BlockList can't match one written in hex, so it's refused.
  if (/^::ffff:/i.test(address)) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    return mapped !== undefined && isPublic(mapped);
  }
  return !nonPublic.check(address, isIPv4(address) ? "ipv4" : "ipv6");
}

export type Lookup = (
  host: string,
) => Promise<{ address: string; family: number }[]>;

const lookupAll: Lookup = (host) => dnsLookup(host, { all: true });

/**
 * Resolves a mail host and returns the address to connect to, so the address checked is the address used. Every
 * address must be public, so the manual form can't reach nunio's own network; INTEGRATION_FAKES allows private ones.
 */
export async function resolvePublicHost(
  host: string,
  { fakes, lookup = lookupAll }: { fakes: boolean; lookup?: Lookup },
): Promise<string> {
  const addresses = await lookup(host).catch(() => []);
  const [first] = addresses;
  if (!first || (!fakes && !addresses.every((a) => isPublic(a.address))))
    throw new MailServerRefused(host);
  return first.address;
}
