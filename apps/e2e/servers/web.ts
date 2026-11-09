import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { tlsOptions } from "./tls.js";

// next's typings don't describe its CommonJS entry under NodeNext; declare the part used here.
type CreateNextServer = (options: {
  dev: boolean;
  dir: string;
  hostname: string;
  port: number;
}) => {
  prepare(): Promise<void>;
  getRequestHandler(): (
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
};
const next = createRequire(import.meta.url)("next") as CreateNextServer;

const port = Number(process.env.PORT);
const app = next({
  dev: false,
  dir: process.env.WEB_DIR!,
  hostname: "app.nunio.test",
  port,
});
await app.prepare();
const handle = app.getRequestHandler();
createServer(tlsOptions(), (req, res) => handle(req, res)).listen(port);
