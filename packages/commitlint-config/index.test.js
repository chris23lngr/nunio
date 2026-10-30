import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { describe, expect, it } from "vitest";
import config from "./index.js";

const loaded = await load(config);

async function check(message) {
  const { valid, errors } = await lint(message, loaded.rules, {
    plugins: loaded.plugins,
    parserOpts: loaded.parserPreset?.parserOpts,
  });
  return { valid, rules: errors.map((e) => e.name) };
}

describe("AI credit", () => {
  it("rejects a Co-Authored-By trailer for an AI agent", async () => {
    const result = await check(
      "feat(api): add health route\n\nServes a liveness probe.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    );
    expect(result).toEqual({ valid: false, rules: ["no-ai-credit"] });
  });

  it("rejects a 'Generated with' line naming an AI tool", async () => {
    const result = await check("fix: retry sign-up\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)");
    expect(result).toEqual({ valid: false, rules: ["no-ai-credit"] });
  });

  it("accepts a human co-author", async () => {
    const result = await check(
      "feat(api): add health route\n\nServes a liveness probe.\n\nCo-authored-by: Ada Lovelace <ada@example.com>",
    );
    expect(result).toEqual({ valid: true, rules: [] });
  });
});

describe("body length", () => {
  it("accepts two sentences hard-wrapped over several lines", async () => {
    const result = await check(
      "feat(db): run the client on a pg pool\n\nThe pool is passed to PrismaPg so the API can attach it\nto Vercel's lifecycle. Idle connections close after five seconds.",
    );
    expect(result).toEqual({ valid: true, rules: [] });
  });

  it("rejects a third sentence", async () => {
    const result = await check(
      "feat(db): run the client on a pg pool\n\nThe pool is passed to PrismaPg. Idle connections close after five seconds. Tests are unchanged.",
    );
    expect(result).toEqual({ valid: false, rules: ["body-max-sentences"] });
  });

  it("counts each bullet as a sentence", async () => {
    const result = await check("chore: tidy\n\n- rename a helper\n- drop a dead route\n- bump a version");
    expect(result).toEqual({ valid: false, rules: ["body-max-sentences"] });
  });

  it("does not count trailers in the footer", async () => {
    const result = await check(
      "fix(api): reject unsigned webhooks\n\nThe route now checks the signature first.\n\nRefs: #12\nCo-authored-by: Ada Lovelace <ada@example.com>",
    );
    expect(result).toEqual({ valid: true, rules: [] });
  });
});

describe("conventional subject", () => {
  it("rejects a subject without a type", async () => {
    const result = await check("Add CI pipeline");
    expect(result.valid).toBe(false);
    expect(result.rules).toEqual(expect.arrayContaining(["type-empty", "subject-empty"]));
  });
});
