/** A mail server nunio connects to, always over TLS (see `mailTls`). */
export interface MailServer {
  host: string;
  port: number;
}

/** A mail provider nunio recognises by the domain of a student's address (#259). */
export interface MailProvider {
  /** The university or service, as the Connect dialog names it. */
  name: string;
  /** The domains of its students' addresses, lowercase. */
  domains: string[];
  imap: MailServer;
  smtp: MailServer;
  /** `m365_oauth` needs XOAUTH2 and a tenant's admin consent, a later slice; until then nunio can't connect it. */
  auth: "password" | "m365_oauth";
  /** Whether the host files a copy of what's sent through SMTP in Sent itself, so nunio must not APPEND one. */
  filesOwnSentCopy: boolean;
}

const university = (
  name: string,
  domains: string[],
  imap: string,
  smtp: string,
): MailProvider => ({
  name,
  domains,
  imap: { host: imap, port: 993 },
  smtp: { host: smtp, port: 587 },
  auth: "password",
  filesOwnSentCopy: false,
});

/**
 * The curated provider list: the ten universities sampled in #259, plus Exchange Online and Gmail, which file their
 * own Sent copy. Every university takes a password over IMAP 993 and SMTP submission on 587 with STARTTLS.
 */
export const mailProviders: readonly MailProvider[] = [
  university(
    "TU München",
    ["mytum.de", "tum.de"],
    "xmail.mwn.de",
    "postout.lrz.de",
  ),
  university(
    "LMU München",
    ["campus.lmu.de"],
    "studlmu.lrz.de",
    "postout.lrz.de",
  ),
  university(
    "RWTH Aachen",
    ["rwth-aachen.de"],
    "mail.rwth-aachen.de",
    "mail.rwth-aachen.de",
  ),
  university(
    "KIT",
    ["student.kit.edu", "kit.edu"],
    "imap.kit.edu",
    "smtp.kit.edu",
  ),
  university(
    "Universität Hamburg",
    ["studium.uni-hamburg.de"],
    "public.uni-hamburg.de",
    "public.uni-hamburg.de",
  ),
  university(
    "FU Berlin",
    ["zedat.fu-berlin.de"],
    "mail.zedat.fu-berlin.de",
    "mail.zedat.fu-berlin.de",
  ),
  university(
    "HU Berlin",
    ["hu-berlin.de"],
    "mailbox.cms.hu-berlin.de",
    "mailhost.cms.hu-berlin.de",
  ),
  university(
    "TU Berlin",
    ["campus.tu-berlin.de", "tu-berlin.de"],
    "mail.tu-berlin.de",
    "mail.tu-berlin.de",
  ),
  university(
    "Universität zu Köln",
    ["smail.uni-koeln.de"],
    "imap.uni-koeln.de",
    "smtp-auth.uni-koeln.de",
  ),
  university(
    "Universität Heidelberg",
    ["stud.uni-heidelberg.de"],
    "imap.urz.uni-heidelberg.de",
    "mail.urz.uni-heidelberg.de",
  ),
  // HSBI's student mail is on Microsoft 365, which refuses passwords for IMAP (#259).
  {
    name: "Exchange Online",
    domains: ["hsbi.de"],
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp.office365.com", port: 587 },
    auth: "m365_oauth",
    filesOwnSentCopy: true,
  },
  // Google refuses the account password for IMAP; an app password works.
  {
    name: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465 },
    auth: "password",
    filesOwnSentCopy: true,
  },
];

/** The fake mail server of dev and e2e (GreenMail), on its own implicit TLS ports; only under INTEGRATION_FAKES. */
const fakeMailProvider: MailProvider = {
  name: "nunio Test-Uni",
  domains: ["nunio.test"],
  imap: { host: "mail.nunio.test", port: 8993 },
  smtp: { host: "mail.nunio.test", port: 8465 },
  auth: "password",
  filesOwnSentCopy: false,
};

/** The provider for an address's domain, or null for the manual form. */
export function mailProviderFor(
  address: string,
  { fakes }: { fakes: boolean },
): MailProvider | null {
  const at = address.lastIndexOf("@");
  if (at < 1) return null;
  const domain = address.slice(at + 1).toLowerCase();
  const providers = fakes
    ? [...mailProviders, fakeMailProvider]
    : mailProviders;
  return providers.find((p) => p.domains.includes(domain)) ?? null;
}

/** What nunio knows about an address's mail servers, as the Connect dialog shows it. */
export type Discovery =
  | {
      status: "recognised";
      university: string;
      imap: MailServer;
      smtp: MailServer;
    }
  /** Its provider needs Microsoft 365 OAuth: "Diese Uni-Mail kann nunio noch nicht verbinden." */
  | { status: "unsupported"; university: string }
  /** The student enters hosts and ports in the manual form. */
  | { status: "unknown" };

export function discoverMailbox(
  address: string,
  options: { fakes: boolean },
): Discovery {
  const provider = mailProviderFor(address, options);
  if (!provider) return { status: "unknown" };
  if (provider.auth !== "password")
    return { status: "unsupported", university: provider.name };
  return {
    status: "recognised",
    university: provider.name,
    imap: provider.imap,
    smtp: provider.smtp,
  };
}
