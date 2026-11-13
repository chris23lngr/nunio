import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SavedProposal } from "../api/chat-queries";
import { ProposalCard } from "./proposal-card";

const decided = (
  type: "tool-proposeTask" | "tool-proposeTaskReopen",
  kind: "task.create" | "task.reopen",
): SavedProposal =>
  ({
    type,
    toolCallId: "call-1",
    input:
      type === "tool-proposeTask"
        ? { title: "Vorlesung nacharbeiten" }
        : { task: "T1" },
    approvalId: "approval-1",
    notes: [],
    action: {
      id: "action-1",
      fingerprint: null,
      expiresAt: null,
      status: "done",
      decision: "approved",
      shown: {
        kind,
        work: { title: "Vorlesung nacharbeiten", course: "Analysis I" },
        from: null,
        to: null,
      },
    },
  }) as SavedProposal;

test.each([
  ["tool-proposeTask", "task.create", "Angelegt"],
  ["tool-proposeTaskReopen", "task.reopen", "Wieder geöffnet"],
] as const)(
  "a decided %s proposal names its Task and what became of it",
  (type, kind, outcome) => {
    render(
      <ProposalCard
        saved={decided(type, kind)}
        busy={false}
        onDecide={() => {}}
      />,
    );

    expect(screen.getByText("Aufgabe Vorlesung nacharbeiten")).toBeTruthy();
    expect(screen.getByText(outcome)).toBeTruthy();
  },
);
