import { describe, expect, it } from "vitest";
import { routes } from "./app.js";

describe("GET /health", () => {
  it("reports ok", async () => {
    const res = await routes.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
