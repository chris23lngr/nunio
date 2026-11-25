import { describe, expect, it } from "vitest";
import { discoverMailbox, mailProviders } from "../index.js";

describe("the mail provider list", () => {
  it("recognises a sampled university by its students' domain", () => {
    expect(
      discoverMailbox("j.schuhmacher@stud.uni-heidelberg.de", { fakes: false }),
    ).toEqual({
      status: "recognised",
      university: "Universität Heidelberg",
      imap: { host: "imap.urz.uni-heidelberg.de", port: 993 },
      smtp: { host: "mail.urz.uni-heidelberg.de", port: 587 },
    });
    expect(discoverMailbox("Max@MyTUM.de", { fakes: false })).toMatchObject({
      status: "recognised",
      university: "TU München",
      imap: { host: "xmail.mwn.de", port: 993 },
    });
  });

  it("starts with the ten sampled universities, all with a password", () => {
    const universities = mailProviders.filter(
      (p) => !["Exchange Online", "Gmail"].includes(p.name),
    );
    expect(universities.map((p) => p.name)).toEqual([
      "TU München",
      "LMU München",
      "RWTH Aachen",
      "KIT",
      "Universität Hamburg",
      "FU Berlin",
      "HU Berlin",
      "TU Berlin",
      "Universität zu Köln",
      "Universität Heidelberg",
    ]);
    for (const provider of universities) {
      expect(provider.auth).toBe("password");
      // On-premises servers don't file a copy of what's sent through SMTP (#259).
      expect(provider.filesOwnSentCopy).toBe(false);
    }
  });

  it("marks Exchange Online and Gmail as filing their own Sent copy", () => {
    const own = mailProviders.filter((p) => p.filesOwnSentCopy);
    expect(own.map((p) => p.name).sort()).toEqual(["Exchange Online", "Gmail"]);
  });

  it("names a Microsoft 365 university nunio can't connect yet", () => {
    expect(discoverMailbox("lea@hsbi.de", { fakes: false })).toEqual({
      status: "unsupported",
      university: "Exchange Online",
    });
  });

  it("leaves an unknown domain to the manual form", () => {
    expect(discoverMailbox("lea@cs.tum.de", { fakes: false })).toEqual({
      status: "unknown",
    });
    expect(discoverMailbox("not-an-address", { fakes: false })).toEqual({
      status: "unknown",
    });
  });

  it("knows nunio.test only under INTEGRATION_FAKES", () => {
    expect(discoverMailbox("student@nunio.test", { fakes: false })).toEqual({
      status: "unknown",
    });
    expect(discoverMailbox("student@nunio.test", { fakes: true })).toEqual({
      status: "recognised",
      university: "nunio Test-Uni",
      imap: { host: "mail.nunio.test", port: 8993 },
      smtp: { host: "mail.nunio.test", port: 8465 },
    });
    expect(mailProviders.flatMap((p) => p.domains)).not.toContain("nunio.test");
  });
});
