import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SavedProposal } from "../api/chat-queries";
import { ProposalOutcome } from "./proposal-outcome";

type Action = NonNullable<SavedProposal["action"]>;
/** An instant at `hour` o'clock on `day` November 2026, in whatever zone the tests run. */
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).toISOString();
const wednesday = { start: at(18, 12), end: at(18, 14) };
const saved = (action: Partial<Action> & Pick<Action, "status">) =>
  ({
    type: "tool-proposeStudyBlock",
    toolCallId: "call-1",
    input: { work: "O1", start: "", end: "" },
    approvalId: "approval-1",
    notes: [],
    action: {
      id: "action-1",
      fingerprint: null,
      expiresAt: null,
      decision: "approved",
      shown: {
        kind: "studyBlock.create",
        work: { title: "Klausur OM", course: "Operations Management" },
        from: null,
        to: wednesday,
        task: null,
      },
      ...action,
    },
  }) as SavedProposal;

test.each([
  ["done", "approved", "Angelegt"],
  ["awaiting_approval", null, "Wartet auf dich"],
  ["refused", "denied", "Abgelehnt"],
  ["expired", null, "Abgelaufen"],
  ["refused", "approved", "Nicht möglich"],
  ["unconfirmed", "approved", "Nicht bestätigt"],
] as const)(
  "a block proposal that is %s (%s) reads %s, with its work and time",
  (status, decision, label) => {
    render(<ProposalOutcome saved={saved({ status, decision })} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Lernblock für „Klausur OM“")).toBeTruthy();
    expect(screen.getByText("Mi., 18. Nov., 12:00 – 14:00 Uhr")).toBeTruthy();
  },
);

test("an Action the student said did not happen reads so, in place of its time", () => {
  render(
    <ProposalOutcome
      saved={saved({ status: "failed", decision: "approved" })}
    />,
  );

  expect(screen.getByText("Nicht passiert")).toBeTruthy();
  expect(screen.getByText("Laut dir nicht passiert")).toBeTruthy();
});

test.each([
  ["studyBlock.move", "Verschoben"],
  ["studyBlock.remove", "Entfernt"],
  ["task.reopen", "Wieder geöffnet"],
] as const)("a done %s reads %s", (kind, label) => {
  render(
    <ProposalOutcome
      saved={saved({
        status: "done",
        shown: {
          kind,
          work: { title: "Klausur OM", course: "Operations Management" },
          from: wednesday,
          to: kind === "studyBlock.remove" ? null : wednesday,
          task: null,
        },
      })}
    />,
  );

  expect(screen.getByText(label)).toBeTruthy();
});

test("a new Task names its Course and the minutes it needs", () => {
  render(
    <ProposalOutcome
      saved={saved({
        status: "done",
        shown: {
          kind: "task.create",
          work: {
            title: "Vorlesung 7 nachbereiten",
            course: "Operations Management",
          },
          from: null,
          to: null,
          task: { role: "follow_up", minutes: 45, event: null },
        },
      })}
    />,
  );

  expect(screen.getByText("Aufgabe „Vorlesung 7 nachbereiten“")).toBeTruthy();
  expect(screen.getByText("Operations Management · 45 Min.")).toBeTruthy();
  expect(screen.getByText("Angelegt")).toBeTruthy();
});

test("a waiting proposal reads as being saved while its answer's decisions are sent", () => {
  render(
    <ProposalOutcome
      saved={saved({ status: "awaiting_approval", decision: null })}
      sending
    />,
  );

  expect(screen.getByText("Wird gespeichert")).toBeTruthy();
  expect(screen.queryByText("Wartet auf dich")).toBeNull();
});

test("says so while a proposal is saved, and when it could not be asked", () => {
  const { rerender } = render(<ProposalOutcome saved={undefined} />);
  expect(screen.getByText("Vorschlag wird gespeichert …")).toBeTruthy();

  rerender(
    <ProposalOutcome saved={{ ...saved({ status: "done" }), action: null }} />,
  );
  expect(
    screen.getByText("Dieser Vorschlag konnte nicht gestellt werden"),
  ).toBeTruthy();
});
