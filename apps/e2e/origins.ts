/** Local stand-ins for app.nunio.app and api.nunio.app (needs /etc/hosts entries), plus a hostile site. */
export const ports = { app: 8443, api: 8444, evil: 8445 } as const;

export const origins = {
  app: `https://app.nunio.test:${ports.app}`,
  api: `https://api.nunio.test:${ports.api}`,
  evil: `https://evil.test:${ports.evil}`,
} as const;

export const cookieDomain = "nunio.test";
