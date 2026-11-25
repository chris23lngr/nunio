import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestCertificate {
  /** PEM of the throwaway CA; clients pass it as `tls.ca`. */
  ca: string;
  key: string;
  cert: string;
}

export const P12_PASSWORD = "changeit";

let created: TestCertificate | undefined;

/** One CA and one leaf for `localhost` per process, so every fake shares the CA a client trusts. */
export function testCertificate(): TestCertificate {
  created ??= createCertificate(["DNS:localhost", "IP:127.0.0.1"]);
  return created;
}

/** A throwaway CA and a leaf for `names`, given as subjectAltName entries such as `DNS:localhost`. */
export function createCertificate(names: string[]): TestCertificate {
  return inTempDir((path) => {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=nunio fake mail CA",
      "-keyout",
      path("ca.key"),
      "-out",
      path("ca.crt"),
    );
    openssl(
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-keyout",
      path("tls.key"),
      "-out",
      path("tls.csr"),
    );
    writeFileSync(
      path("leaf.ext"),
      [
        `subjectAltName=${names.join(",")}`,
        "basicConstraints=CA:FALSE",
        "keyUsage=digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
      ].join("\n"),
    );
    openssl(
      "x509",
      "-req",
      "-days",
      "2",
      "-in",
      path("tls.csr"),
      "-CA",
      path("ca.crt"),
      "-CAkey",
      path("ca.key"),
      "-CAcreateserial",
      "-extfile",
      path("leaf.ext"),
      "-out",
      path("tls.crt"),
    );
    return {
      ca: readFileSync(path("ca.crt"), "utf8"),
      key: readFileSync(path("tls.key"), "utf8"),
      cert: readFileSync(path("tls.crt"), "utf8"),
    };
  });
}

/** Key and certificate (PEM) as PKCS#12 under `P12_PASSWORD`, for GreenMail. */
export function toP12(key: string, cert: string): Buffer {
  return inTempDir((path) => {
    writeFileSync(path("tls.key"), key);
    writeFileSync(path("tls.crt"), cert);
    openssl(
      "pkcs12",
      "-export",
      "-inkey",
      path("tls.key"),
      "-in",
      path("tls.crt"),
      "-passout",
      `pass:${P12_PASSWORD}`,
      "-out",
      path("tls.p12"),
    );
    return readFileSync(path("tls.p12"));
  });
}

function openssl(...args: string[]) {
  execFileSync("openssl", args, { stdio: "pipe" });
}

function inTempDir<T>(run: (path: (name: string) => string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nunio-test-tls-"));
  try {
    return run((name) => join(dir, name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
