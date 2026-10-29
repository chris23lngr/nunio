# Separate app and API origins with a parent-domain session cookie

The web app and API are served from separate origins, `app.nunio.app` and `api.nunio.app` (staging: `app.staging.nunio.app` / `api.staging.nunio.app`). Better Auth runs on the API. Its session cookie is scoped to the parent domain so the Next.js server can check sessions and forward them. Credentialed CORS and Better Auth's trusted origins allow exactly the `app.` origin. Because every subdomain of the session domain receives the cookie, **nothing but `app.` and `api.` may ever be hosted under the product domain**: marketing, docs, and any third-party-hosted pages live on a separate domain.

Vercel PR previews (`*.vercel.app`) are a different site from the session domain, so previews are UI-only, without login. Authenticated testing happens on the stable staging domains. Revisit per-PR environments (for example Neon branches) after the pilot.

## Considered Options

- **Single origin with `/api/*` routed to the API project**: simpler cookies and no CORS, as the identity research suggested; rejected by the founder in favour of distinct origins.
- **API-only cookie**: avoids exposing the cookie to `app.`, but rules out server-side session checks in Next.js.
