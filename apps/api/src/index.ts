// Vercel zero-config entrypoint for Hono: the default export is the app.
import { appFromEnv } from "./server.js";

export default appFromEnv(process.env);
