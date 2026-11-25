import { describe, expect, it } from "vitest";
import { integrationFakes } from "./index.js";

describe("INTEGRATION_FAKES", () => {
  it("is off unless set to true", () => {
    expect(integrationFakes({})).toBe(false);
    expect(integrationFakes({ INTEGRATION_FAKES: "false" })).toBe(false);
  });

  it("is on in dev and test, even under NODE_ENV=production as the e2e API runs", () => {
    expect(
      integrationFakes({ INTEGRATION_FAKES: "true", NODE_ENV: "production" }),
    ).toBe(true);
  });

  it("refuses to start on Vercel", () => {
    expect(() =>
      integrationFakes({ INTEGRATION_FAKES: "true", VERCEL: "1" }),
    ).toThrow("INTEGRATION_FAKES must not be set on a deployment");
  });

  it("refuses to start on Render", () => {
    expect(() =>
      integrationFakes({ INTEGRATION_FAKES: "true", RENDER: "true" }),
    ).toThrow("INTEGRATION_FAKES must not be set on a deployment");
  });
});
