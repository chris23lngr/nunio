import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { ReadableTool } from "./integration-reads.js";
import { modelToolName } from "./integration-reads.js";
import type { IntegrationCallPart } from "./parts.js";
import type { Proposal } from "./proposals.js";
import type { Turn } from "./turn.js";

/** A write tool of a Connection the Chat may use, with its pinned definition and what its card shows. */
export interface WritableTool extends Omit<ReadableTool, "integration"> {
  integration: IntegrationCallPart["integration"];
  /** The argument the Approval card shows first. */
  headlineArgument: string | null;
  /** The hash of the pinned definition the model is shown, which the call is asked under. */
  definitionHash: string;
}

/**
 * The write tools of the Connections a Chat may use, built from their pinned definitions. None runs in the turn: each
 * call is held in `proposals` as an `integration.call` Action, asked of the student once the answer is saved
 * (ADR-0019 "proposal batches"). The Connection joins `turn.connections`, since the answer then holds what would be
 * written through it. `taken` holds the model names other tools have, so none is given twice.
 */
export function integrationWriteTools(
  turn: Turn,
  proposals: Map<string, Proposal>,
  writable: readonly WritableTool[],
  taken: Record<string, unknown>,
) {
  const tools: Record<string, Tool<Record<string, unknown>>> = {};
  const toolApproval: Record<
    string,
    (
      input: Record<string, unknown>,
      options: { toolCallId: string },
    ) => { type: "user-approval" }
  > = {};
  for (const writableTool of writable) {
    const { connectionId, integration, name, label, definition } = writableTool;
    const sanitised = modelToolName(integration.key, name);
    const modelName =
      sanitised in tools || sanitised in taken
        ? modelToolName(integration.key, name, { hashed: true })
        : sanitised;
    tools[modelName] = tool({
      description: `${definition.description}\n\n(${integration.name}, write tool: nunio shows the student every argument and calls it only once they approve. Call it only for what the student asked for.)`,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.inputSchema),
    });
    toolApproval[modelName] = (input, { toolCallId }) => {
      turn.connections.add(connectionId);
      proposals.set(toolCallId, {
        kind: "integration.call",
        args: {
          integrationKey: integration.key,
          connectionId,
          toolName: name,
          pinHash: writableTool.definitionHash,
          arguments: input,
        },
        shown: {
          integration,
          tool: {
            name,
            label,
            headlineArgument: writableTool.headlineArgument,
          },
        },
        notes: [],
      });
      return { type: "user-approval" };
    };
  }
  return { tools, toolApproval };
}
