import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SavedProposal } from "../api/chat-queries";
import { ProposalCard, UnconfirmedActionCard } from "./proposal-card";

type Shown = NonNullable<SavedProposal["action"]>["shown"];
/** An instant at `hour` o'clock on `day` November 2026, in whatever zone the tests run. */
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).toISOString();

const thursday = { start: at(19, 12), end: at(19, 14) };
const friday = { start: at(20, 14), end: at(20, 16) };
const block = (shown: Partial<Shown>): Shown => ({
  kind: "studyBlock.create",
  work: { title: "Übungsblatt 4", course: "Analysis I" },
  from: null,
  to: null,
  task: null,
  ...shown,
});
const proposal = (
  shown: Shown,
  notes: SavedProposal["notes"] = [],
): SavedProposal =>
  ({
    type: "tool-proposeStudyBlock",
    toolCallId: "call-1",
    input: { work: "O1", start: "", end: "" },
    approvalId: "approval-1",
    notes,
    action: {
      id: "action-1",
      fingerprint: "fingerprint-1",
      expiresAt: "2099-01-01T00:00:00Z",
      status: "awaiting_approval",
      decision: null,
      shown,
    },
  }) as SavedProposal;
const ask = (shown: Shown, notes?: SavedProposal["notes"]) =>
  render(
    <ProposalCard
      proposal={proposal(shown, notes)}
      position={{ index: 0, total: 1 }}
      busy={false}
      onDecide={() => {}}
    />,
  );

test.each([
  [
    "a new block",
    block({ to: friday }),
    "Neuen Lernblock am Freitag von 14 bis 16 Uhr hinzufügen?",
    "nunio möchte einen neuen Lernblock am Freitag 20. Nov. von 14 bis 16 Uhr für „Übungsblatt 4“ im Kurs Analysis I hinzufügen.",
  ],
  [
    "a move",
    block({ kind: "studyBlock.move", from: thursday, to: friday }),
    "Möchtest du deinen Lernblock für „Übungsblatt 4“ im Kurs Analysis I am Donnerstag von 12 bis 14 Uhr verschieben?",
    ["Do., 19. Nov., 12:00 – 14:00 Uhr", "Fr., 20. Nov., 14:00 – 16:00 Uhr"],
  ],
  [
    "a removal",
    block({ kind: "studyBlock.remove", from: thursday }),
    "Möchtest du deinen Lernblock für „Übungsblatt 4“ im Kurs Analysis I am Donnerstag von 12 bis 14 Uhr entfernen?",
    "Do., 19. Nov., 12:00 – 14:00 Uhr",
  ],
  [
    "a Follow-up Task",
    block({
      kind: "task.create",
      work: { title: "Vorlesung nacharbeiten", course: "Analysis I" },
      task: {
        role: "follow_up",
        minutes: 45,
        event: { title: "Analysis Vorlesung", start: at(17, 10) },
      },
    }),
    "Aufgabe „Vorlesung nacharbeiten“ anlegen?",
    "nunio möchte im Kurs Analysis I eine neue Aufgabe zur Nachbereitung des Termins „Analysis Vorlesung“ am Di., 17. Nov. anlegen. Geschätzt 45 Min.",
  ],
  [
    "a Task without Course or Course Event",
    block({
      kind: "task.create",
      work: { title: "Bibliothek", course: null },
      task: { role: null, minutes: null, event: null },
    }),
    "Aufgabe „Bibliothek“ anlegen?",
    "nunio möchte eine neue Aufgabe anlegen.",
  ],
  [
    "reopening a Task",
    block({
      kind: "task.reopen",
      work: { title: "Übungsblatt 4", course: "Analysis I" },
    }),
    "Aufgabe „Übungsblatt 4“ wieder öffnen?",
    "Du hast diese Aufgabe im Kurs Analysis I als erledigt markiert. nunio möchte sie wieder auf deine offene Liste setzen.",
  ],
])("asks about %s as the exact Action", (_, shown, title, detail) => {
  ask(shown);

  expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  const text = screen.getByRole("region", {
    name: "Vorschlag prüfen",
  }).textContent;
  for (const part of [detail].flat()) expect(text).toContain(part);
});

test("notes each Preference a block would break", () => {
  ask(block({ to: friday }), ["outside_study_window", "daily_limit"]);

  expect(screen.getByText("Außerhalb deines Lernfensters")).toBeTruthy();
  expect(screen.getByText("Über deinem Tageslimit")).toBeTruthy();
});

test("while the decisions are sent, neither button nor going back is offered", () => {
  render(
    <ProposalCard
      proposal={proposal(block({ to: friday }))}
      position={{ index: 1, total: 2 }}
      busy
      onBack={() => {}}
      onDecide={() => {}}
    />,
  );

  expect(
    screen.getByRole("region", { name: "Vorschläge prüfen" }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Ablehnen" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Wird gespeichert …",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Zurück" })).toBeNull();
});

test.each([
  ["studyBlock.move", "Wurde dein Lernblock auf Freitag verschoben?"],
  ["task.reopen", "Wurde die Aufgabe „Übungsblatt 4“ wieder geöffnet?"],
] as const)("asks whether an unconfirmed %s happened", (kind, title) => {
  render(
    <UnconfirmedActionCard
      proposal={proposal(block({ kind, from: thursday, to: friday }))}
      busy={false}
      onResolve={() => {}}
    />,
  );

  expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ist passiert" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Ist nicht passiert" }),
  ).toBeTruthy();
});
