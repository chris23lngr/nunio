import { describe, expect, it } from "vitest";
import { MailServerRefused, mailTls, resolvePublicHost } from "../index.js";

describe("the port rule", () => {
  it("takes implicit TLS on 993 and 465 and STARTTLS on 143 and 587", () => {
    expect(mailTls("imap", 993, { fakes: false })).toBe("implicit");
    expect(mailTls("imap", 143, { fakes: false })).toBe("starttls");
    expect(mailTls("smtp", 465, { fakes: false })).toBe("implicit");
    expect(mailTls("smtp", 587, { fakes: false })).toBe("starttls");
  });

  it("refuses every other port, plain SMTP on 25 and the other protocol's ports included", () => {
    for (const [protocol, port] of [
      ["smtp", 25],
      ["imap", 465],
      ["smtp", 993],
      ["imap", 8993],
      ["smtp", 2525],
    ] as const)
      expect(mailTls(protocol, port, { fakes: false })).toBeNull();
  });

  it("takes the fakes' other ports as implicit TLS under INTEGRATION_FAKES", () => {
    expect(mailTls("imap", 8993, { fakes: true })).toBe("implicit");
    expect(mailTls("smtp", 8465, { fakes: true })).toBe("implicit");
    expect(mailTls("smtp", 587, { fakes: true })).toBe("starttls");
  });
});

describe("the public-address check", () => {
  const resolvingTo =
    (...addresses: string[]) =>
    async () =>
      addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }));

  it("connects to a public address of the host", async () => {
    await expect(
      resolvePublicHost("imap.urz.uni-heidelberg.de", {
        fakes: false,
        lookup: resolvingTo("129.206.100.162"),
      }),
    ).resolves.toBe("129.206.100.162");
    await expect(
      resolvePublicHost("mail.example", {
        fakes: false,
        lookup: resolvingTo("2a00:1450:4001:80b::200e"),
      }),
    ).resolves.toBe("2a00:1450:4001:80b::200e");
    // A public IPv4 address written as IPv4-mapped IPv6 is checked as IPv4.
    await expect(
      resolvePublicHost("mail.example", {
        fakes: false,
        lookup: resolvingTo("::ffff:129.206.100.162"),
      }),
    ).resolves.toBe("::ffff:129.206.100.162");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.4.1",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:10.0.0.5",
    "::ffff:a00:5",
    "0:0:0:0:0:ffff:7f00:1",
    // IPv4-compatible, SIIT, NAT64 local-use, site-local, 6to4, Teredo and the other IETF blocks, 6to4 relay.
    "::127.0.0.1",
    "::ffff:0:a00:5",
    "64:ff9b:1::a00:5",
    "fec0::1",
    "2002:a00:5::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:db8::1",
    "3fff::1",
    "192.88.99.1",
  ])("refuses a host that resolves to %s", async (address) => {
    await expect(
      resolvePublicHost("mail.example", {
        fakes: false,
        lookup: resolvingTo(address),
      }),
    ).rejects.toBeInstanceOf(MailServerRefused);
  });

  it.each([
    "fe80::1%1",
    "::1%lo0",
    // A zone means a local interface, so even a global address with one is refused.
    "2a00:1450:4001:80b::200e%eth0",
    "not-an-address",
  ])(
    "refuses, without throwing, an address with a zone or that doesn't parse: %s",
    async (address) => {
      await expect(
        resolvePublicHost("mail.example", {
          fakes: false,
          lookup: resolvingTo(address),
        }),
      ).rejects.toBeInstanceOf(MailServerRefused);
    },
  );

  it("refuses a host when any of its addresses is private", async () => {
    await expect(
      resolvePublicHost("mail.example", {
        fakes: false,
        lookup: resolvingTo("129.206.100.162", "10.0.0.5"),
      }),
    ).rejects.toBeInstanceOf(MailServerRefused);
  });

  it("refuses a host that doesn't resolve", async () => {
    await expect(
      resolvePublicHost("mail.invalid", {
        fakes: false,
        lookup: async () => {
          throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
        },
      }),
    ).rejects.toBeInstanceOf(MailServerRefused);
  });

  it("allows private addresses only under INTEGRATION_FAKES", async () => {
    await expect(
      resolvePublicHost("mail.nunio.test", {
        fakes: true,
        lookup: resolvingTo("127.0.0.1"),
      }),
    ).resolves.toBe("127.0.0.1");
  });
});
