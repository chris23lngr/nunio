// Vercel entrypoint. The Hono builder starts from compiled `dist/` (vercel.json `outputDirectory`) and
// only accepts an entry file that imports "hono" itself, so mount the app on a Hono instance here.
import { Hono } from "hono";
import { appFromEnv } from "./create-app.js";

// Only deployments start here, so the fakes are refused even if VERCEL were missing.
if (process.env.INTEGRATION_FAKES)
  throw new Error("INTEGRATION_FAKES must not be set on a deployment");

export default new Hono().route("/", await appFromEnv(process.env));
