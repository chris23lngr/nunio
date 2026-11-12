import { createServer } from "node:https";
import { serve } from "@hono/node-server";
import { appFromEnv } from "@nunio/api/create-app";
import { tlsOptions } from "./tls.js";

serve({
  fetch: (await appFromEnv(process.env)).fetch,
  port: Number(process.env.PORT),
  createServer,
  serverOptions: tlsOptions(),
});
