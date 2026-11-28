import { describe, expect, it } from "vitest";
import type { WritableTool } from "./integration-writes.js";
import { integrationWriteTools } from "./integration-writes.js";
import type { Proposal } from "./proposals.js";
import { createTurn } from "./turn.js";

const createPage: WritableTool = {
  connectionId: "connection-1",
  integration: {
    key: "testnotizen",
    name: "Testnotizen",
    logo: "/integrations/testnotizen.svg",
  },
  name: "notes.create_page",
  label: "Seite anlegen",
  headlineArgument: "title",
  definition: {
    description: "Creates a new page in the workspace.",
    inputSchema: { type: "object" },
  },
  definitionHash: "pin-1",
};

describe("the write tools of a Chat's Connections", () => {
  it("never runs a write, but holds it as an integration.call under the pin the model was shown", async () => {
    const turn = createTurn();
    const proposals = new Map<string, Proposal>();
    const { tools, toolApproval } = integrationWriteTools(
      turn,
      proposals,
      [createPage],
      {},
    );

    expect(tools.testnotizen__notes_create_page?.execute).toBeUndefined();
    expect(tools.testnotizen__notes_create_page?.description).toContain(
      "calls it only once they approve",
    );
    const status = toolApproval.testnotizen__notes_create_page!(
      { title: "Woche 3", content: "Eigenwerte" },
      { toolCallId: "call-1" },
    );

    expect(status).toEqual({ type: "user-approval" });
    expect(proposals.get("call-1")).toEqual({
      kind: "integration.call",
      args: {
        integrationKey: "testnotizen",
        connectionId: "connection-1",
        toolName: "notes.create_page",
        pinHash: "pin-1",
        arguments: { title: "Woche 3", content: "Eigenwerte" },
      },
      shown: {
        integration: createPage.integration,
        tool: {
          name: "notes.create_page",
          label: "Seite anlegen",
          headlineArgument: "title",
        },
      },
      notes: [],
    });
    // The answer holds what would be written, so it is sealed under the Connection's key.
    expect([...turn.connections]).toEqual(["connection-1"]);
  });

  it("names a write apart from a read tool whose name sanitises alike", () => {
    const { tools } = integrationWriteTools(
      createTurn(),
      new Map(),
      [createPage],
      { testnotizen__notes_create_page: {} },
    );

    expect(Object.keys(tools)).toEqual([
      expect.stringMatching(/^testnotizen__notes_create_page_[0-9a-f]{8}$/),
    ]);
  });
});
