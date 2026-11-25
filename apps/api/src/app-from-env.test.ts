import { expect, it } from "vitest";
import { appFromEnv } from "./create-app.js";

it("refuses to start on Vercel with INTEGRATION_FAKES set", async () => {
  await expect(
    appFromEnv({ INTEGRATION_FAKES: "true", VERCEL: "1" }),
  ).rejects.toThrow("INTEGRATION_FAKES must not be set on a deployment");
});
