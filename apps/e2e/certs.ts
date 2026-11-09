import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Certs {
  caPath: string;
  keyPath: string;
  certPath: string;
}

/** A throwaway CA and one leaf certificate for every local origin. */
export function createCerts(dir: string, hosts: string[]): Certs {
  mkdirSync(dir, { recursive: true });
  const path = (name: string) => join(dir, name);
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { stdio: "pipe" });

  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=nunio e2e CA",
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
    "/CN=nunio e2e",
    "-keyout",
    path("tls.key"),
    "-out",
    path("tls.csr"),
  );
  writeFileSync(
    path("leaf.ext"),
    [
      `subjectAltName=${hosts.map((h) => `DNS:${h}`).join(",")}`,
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
    caPath: path("ca.crt"),
    keyPath: path("tls.key"),
    certPath: path("tls.crt"),
  };
}
