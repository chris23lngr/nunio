import { serve } from "@hono/node-server";
import { appFromEnv } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: appFromEnv(process.env).fetch, port });
console.log(JSON.stringify({ msg: "api listening", port }));
