// Commit message rules for nunio (AGENTS.md, "Commits"); the root commitlint.config.js uses this.
import { fileURLToPath } from "node:url";

const aiTools =
  /\b(claude|anthropic|copilot|openai|chatgpt|gpt-\d|codex|cursor|gemini|devin|aider|windsurf|codeium)\b/i;
const creditLine = /^(co-authored-by:|generated (with|by)\b|.*🤖)/i;

/** AI agents are never credited: no Co-Authored-By trailer or "Generated with" line naming one. */
function noAiCredit({ raw }) {
  const credits = raw
    .split("\n")
    .filter((line) => creditLine.test(line.trim()) && aiTools.test(line));
  return [
    credits.length === 0,
    `remove AI credit lines: ${credits.map((l) => l.trim()).join(" | ")}`,
  ];
}

const trailer = /^[A-Za-z][\w-]*(: | #)/;

/** Sentences in the body: hard-wrapped lines are joined, each bullet counts, trailers don't. */
function sentences(raw) {
  const paragraphs = raw
    .trim()
    .split(/\n\s*\n/)
    .slice(1);
  if (
    paragraphs.length &&
    paragraphs
      .at(-1)
      .split("\n")
      .every((line) => trailer.test(line))
  ) {
    paragraphs.pop();
  }
  return paragraphs
    .flatMap((paragraph) => paragraph.split(/\n(?=\s*[-*] )/))
    .map((chunk) =>
      chunk
        .replace(/^\s*[-*] /, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .flatMap((chunk) => chunk.split(/(?<=[.!?])\s+/))
    .filter(Boolean).length;
}

/** Commit bodies say why in at most `max` sentences. */
function bodyMaxSentences({ raw }, _when, max = 2) {
  const count = sentences(raw);
  return [count <= max, `the body has ${count} sentences; keep it to ${max}`];
}

export default {
  // Absolute, so commitlint finds it from the repo root under Bun's isolated installs.
  extends: [
    fileURLToPath(import.meta.resolve("@commitlint/config-conventional")),
  ],
  plugins: [
    {
      rules: {
        "no-ai-credit": noAiCredit,
        "body-max-sentences": bodyMaxSentences,
      },
    },
  ],
  rules: {
    "no-ai-credit": [2, "always"],
    "body-max-sentences": [2, "always", 2],
  },
};
