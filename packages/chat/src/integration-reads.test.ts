import { principal } from "@nunio/delegation";
import { describe, expect, it } from "vitest";
import type { ReadableTool } from "./integration-reads.js";
import { integrationReadTools, modelToolName } from "./integration-reads.js";
import { createTurn } from "./turn.js";

const readable = (name: string, key = "testnotizen"): ReadableTool => ({
  connectionId: `connection-${key}`,
  integration: { key, name: key },
  name,
  label: name,
  definition: { description: "Reads.", inputSchema: { type: "object" } },
});

const names = (...tools: (string | [key: string, name: string])[]) =>
  Object.keys(
    integrationReadTools(
      createTurn(),
      {
        open: () => {
          throw new Error("No read is made");
        },
      },
      principal.fromSession({ studentId: "student-1" }),
      tools.map((tool) =>
        typeof tool === "string" ? readable(tool) : readable(tool[1], tool[0]),
      ),
    ).tools,
  );

describe("the names the model is given for Integration tools", () => {
  it("namespaces a tool by its Integration and keeps only letters, digits, _ and -", () => {
    expect(modelToolName("testnotizen", "notes.search")).toBe(
      "testnotizen__notes_search",
    );
  });

  it("cuts a long name to 64 characters, ending in a hash of the whole", () => {
    const name = modelToolName("testnotizen", `notes.${"x".repeat(80)}`);

    expect(name).toHaveLength(64);
    expect(name).toMatch(/^testnotizen__notes_x+_[0-9a-f]{8}$/);
  });

  it("keeps two tools apart whose names sanitise alike", () => {
    const [first, second] = names("notes.search", "notes_search");

    expect(first).toBe("testnotizen__notes_search");
    expect(second).toMatch(/^testnotizen__notes_search_[0-9a-f]{8}$/);
  });

  it("keeps apart tools of two Integrations whose keys and names join alike", () => {
    const [first, second] = names(["foo", "bar__baz"], ["foo__bar", "baz"]);

    expect(first).toBe("foo__bar__baz");
    expect(second).toMatch(/^foo__bar__baz_[0-9a-f]{8}$/);
    expect(modelToolName("foo", "bar__baz", { hashed: true })).not.toBe(
      modelToolName("foo__bar", "baz", { hashed: true }),
    );
  });
});
