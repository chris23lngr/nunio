/**
 * Where the suite runs. Locally (default): stand-ins for app.nunio.app and api.nunio.app, which need
 * /etc/hosts entries. With E2E_TARGET=staging: the deployed staging origins. The hostile site is
 * always served locally.
 */
export const target =
  process.env.E2E_TARGET === "staging" ? "staging" : "local";

export const ports = {
  app: 8443,
  api: 8444,
  evil: 8445,
  mcp: 8446,
  imaps: 8993,
  smtps: 8465,
} as const;

const evil = `https://evil.test:${ports.evil}`;

export const origins =
  target === "staging"
    ? {
        app: "https://app.staging.nunio.app",
        api: "https://api.staging.nunio.app",
        evil,
      }
    : {
        app: `https://app.nunio.test:${ports.app}`,
        api: `https://api.nunio.test:${ports.api}`,
        evil,
      };

/**
 * The Integration fakes beside the local API: the Testnotizen MCP server, and GreenMail on `ports.imaps` and
 * `ports.smtps`, the ports the dev stack's GreenMail listens on too.
 */
export const fakes = {
  mcp: `https://mcp.nunio.test:${ports.mcp}`,
  mail: "mail.nunio.test",
};

export const cookieDomain =
  target === "staging" ? "staging.nunio.app" : "nunio.test";

/** Key for the spike c raw-body route; on staging pass the API's SPIKE_WEBHOOK_SECRET. */
export const spikeWebhookSecret =
  target === "staging" ? stagingSpikeSecret() : "spike-c-e2e-webhook-secret";

function stagingSpikeSecret(): string {
  const secret = process.env.SPIKE_WEBHOOK_SECRET;
  if (!secret)
    throw new Error(
      "E2E_TARGET=staging needs SPIKE_WEBHOOK_SECRET (apps/e2e/.env.staging)",
    );
  return secret;
}
