import { createHash, randomBytes } from "node:crypto";
import type { FakeMcpServer } from "./mcp-server.js";

/** An access token from the fake, through DCR and PKCE as a vendor would issue one. */
export async function tokenFrom(server: FakeMcpServer) {
  const redirect = "http://localhost/callback";
  const client = (await (
    await fetch(`${server.url}/register`, {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
      }),
    })
  ).json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${server.url}/authorize`);
  for (const [name, value] of Object.entries({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    resource: server.mcpUrl,
  }))
    authorize.searchParams.set(name, value);
  const back = new URL(
    (await fetch(authorize, { redirect: "manual" })).headers.get("location")!,
  );
  const tokens = (await (
    await fetch(`${server.url}/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        code_verifier: verifier,
        redirect_uri: redirect,
        client_id: client.client_id,
      }),
    })
  ).json()) as { access_token: string };
  return tokens.access_token;
}
