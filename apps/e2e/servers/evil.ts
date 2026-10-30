import { createServer } from "node:https";
import { tlsOptions } from "./tls.js";

createServer(tlsOptions(), (_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>evil</title><p>Not nunio.</p>");
}).listen(Number(process.env.PORT));
