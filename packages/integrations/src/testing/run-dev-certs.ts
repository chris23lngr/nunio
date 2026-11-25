/**
 * Writes the dev stack's mail certificate into `CERTS_DIR`: `node --import tsx src/testing/run-dev-certs.ts`.
 *
 * `ca.crt` is a dev CA the API and worker trust through `NODE_EXTRA_CA_CERTS`. `greenmail.p12` holds GreenMail's key
 * and its certificate for `mail.nunio.test` (`tls.crt`) under `P12_PASSWORD`. They are kept while they stay valid for
 * another 30 days, so a running stack keeps the CA it trusts.
 */
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCertificate, toP12 } from "./certificate.js";

const dir = process.env.CERTS_DIR;
if (!dir) throw new Error("CERTS_DIR must be set");
const path = (name: string) => join(dir, name);
const day = 24 * 3600 * 1000;

const valid =
  ["ca.crt", "tls.crt", "greenmail.p12"].every((name) =>
    existsSync(path(name)),
  ) &&
  new Date(new X509Certificate(readFileSync(path("tls.crt"))).validTo) >
    new Date(Date.now() + 30 * day);
if (!valid) {
  const { ca, key, cert } = createCertificate(["DNS:mail.nunio.test"], 365);
  writeFileSync(path("greenmail.p12"), toP12(key, cert));
  writeFileSync(path("tls.crt"), cert);
  writeFileSync(path("ca.crt"), ca);
  console.log(`Wrote a certificate for mail.nunio.test to ${dir}`);
}
