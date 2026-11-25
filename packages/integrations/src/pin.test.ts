import { expect, it } from "vitest";
import { definitionHash } from "./pin.js";

const definition = {
  description: "Reads one note by its id.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
};

it("hashes a definition the same whatever its key order", () => {
  expect(
    definitionHash({
      inputSchema: {
        required: ["id"],
        properties: { id: { type: "string" } },
        type: "object",
      },
      description: "Reads one note by its id.",
    }),
  ).toBe(definitionHash(definition));
});

it("hashes a definition with undefined values as Postgres stores it, so it never looks drifted", () => {
  const fromServer = {
    ...definition,
    inputSchema: {
      ...definition.inputSchema,
      title: undefined,
      examples: [1, undefined],
    },
  };
  const readBack = JSON.parse(JSON.stringify(fromServer));

  expect(readBack.inputSchema).not.toHaveProperty("title");
  expect(definitionHash(fromServer)).toBe(definitionHash(readBack));
  expect(definitionHash(fromServer)).toBe(
    definitionHash({
      ...definition,
      inputSchema: { ...definition.inputSchema, examples: [1, null] },
    }),
  );
});

it("tells different definitions apart", () => {
  expect(
    definitionHash({ ...definition, description: "Reads a note." }),
  ).not.toBe(definitionHash(definition));
  expect(
    definitionHash({
      ...definition,
      inputSchema: { ...definition.inputSchema, required: [] },
    }),
  ).not.toBe(definitionHash(definition));
});
