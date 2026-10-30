// Vercel entrypoint. The Hono builder starts from compiled `dist/` (vercel.json `outputDirectory`) and
// only accepts an entry file that imports "hono" itself, so mount the app on a Hono instance here.
import { Hono } from "hono";
import { appFromEnv } from "./create-app.js";

export default new Hono().route("/", appFromEnv(process.env));
