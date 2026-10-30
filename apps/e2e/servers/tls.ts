import { readFileSync } from "node:fs";

export function tlsOptions() {
  return {
    key: readFileSync(process.env.TLS_KEY!),
    cert: readFileSync(process.env.TLS_CERT!),
  };
}
