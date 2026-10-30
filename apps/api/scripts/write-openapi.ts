// Writes the committed contract consumed by @nunio/api-client (ADR-0003).
import { writeFileSync } from "node:fs";
import { app, openApiConfig } from "../src/app.js";

const doc = app.getOpenAPI31Document(openApiConfig);
writeFileSync(new URL("../openapi.json", import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
