import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIPv4, isIPv6 } from "node:net";

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

/** IPv4 addresses that aren't on the public internet: private, loopback, link-local, shared, reserved and the like. */
const nonPublicIPv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  nonPublicIPv4.addSubnet(network, prefix, "ipv4");

/** IPv6 is allowed only in global unicast, 2000::/3 ... */
const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");
/** ... minus its special-purpose blocks: IETF protocol assignments (Teredo, benchmarking, ORCHID), documentation, 6to4. */
const specialIPv6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  specialIPv6.addSubnet(network, prefix, "ipv6");

/** Fails closed: an address with a zone (a local interface) or one that isn't an IP address is not public. */
function isPublic(address: string): boolean {
  if (isIPv4(address)) return !nonPublicIPv4.check(address, "ipv4");
  if (!isIPv6(address) || address.includes("%")) return false;
  // The URL parser writes an IPv6 address canonically, an IPv4-mapped one as ::ffff:hhhh:hhhh.
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const [high, low] = [mapped[1], mapped[2]].map((group) =>
      Number.parseInt(group ?? "", 16),
    ) as [number, number];
    return isPublic(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return (
    globalUnicast.check(canonical, "ipv6") &&
    !specialIPv6.check(canonical, "ipv6")
  );
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
