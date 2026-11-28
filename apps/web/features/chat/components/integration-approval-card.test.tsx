import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { IntegrationProposal } from "../api/chat-queries";
import { IntegrationApprovalCard } from "./integration-approval-card";

const proposal = (
  args: Record<string, unknown>,
  headlineArgument: string | null = "title",
): IntegrationProposal => ({
  type: "tool-integrationCall",
  toolCallId: "call-1",
  input: {},
  approvalId: "approval-1",
  integration: {
    key: "testnotizen",
    name: "Testnotizen",
    logo: "/integrations/testnotizen.svg",
  },
  tool: { name: "notes.create_page", label: "Seite anlegen", headlineArgument },
  action: {
    id: "action-1",
    fingerprint: "fingerprint-1",
    expiresAt: "2099-01-01T00:00:00Z",
    status: "awaiting_approval",
    decision: null,
    arguments: args,
  },
});
const ask = (
  args: Record<string, unknown>,
  onDecide: (decision: "approve" | "deny") => void = () => {},
) =>
  render(
    <IntegrationApprovalCard
      proposal={proposal(args)}
      position={{ index: 0, total: 1 }}
      busy={false}
      onDecide={onDecide}
    />,
  );
/** The value shown under an argument's label. */
const shownUnder = (label: string) =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling!;

test("asks with the Integration, nunio's label, and the headline argument first", () => {
  ask({ content: "Eigenwerte", title: "Woche 3" });

  const card = screen.getByRole("region", { name: "Freigabe nötig" });
  within(card).getByRole("img", { name: "Testnotizen" });
  within(card).getByRole("heading", { name: "Seite anlegen?" });
  expect(
    [...card.querySelectorAll("dt")].map((term) => term.textContent),
  ).toEqual(["title", "content"]);
});

test("shows a long body in full", () => {
  const body = `${"Eigenwerte und Eigenvektoren. ".repeat(400)}Ende.`;
  ask({ title: "Woche 3", content: body });

  expect(shownUnder("content").textContent).toBe(body);
  expect(screen.queryByRole("button", { name: /mehr|ganz/i })).toBeNull();
});

test("indents nested arguments beneath their label", () => {
  ask({
    title: "Woche 3",
    properties: { course: "Lineare Algebra", tags: ["Klausur", "Woche 3"] },
  });

  const nested = shownUnder("properties");
  expect(nested.querySelector("dl")).not.toBeNull();
  expect(
    within(nested as HTMLElement).getByText("course", { selector: "dt" })
      .nextElementSibling?.textContent,
  ).toBe("Lineare Algebra");
  const tags = within(nested as HTMLElement).getByText("tags", {
    selector: "dt",
  }).nextElementSibling as HTMLElement;
  expect(
    [...tags.querySelectorAll("dd")].map((value) => value.textContent),
  ).toEqual(["Klausur", "Woche 3"]);
});

test("shows a URL or Markdown as plain text, never as a link", () => {
  ask({
    title: "[Hier klicken](https://evil.test/a)",
    content: "https://evil.test/b **fett**",
  });

  expect(screen.queryByRole("link")).toBeNull();
  expect(shownUnder("title").textContent).toBe(
    "[Hier klicken](https://evil.test/a)",
  );
  expect(shownUnder("content").textContent).toBe(
    "https://evil.test/b **fett**",
  );
});

test("Ablehnen declines and Annehmen approves, as on the proposal card", async () => {
  const onDecide = vi.fn();
  ask({ title: "Woche 3" }, onDecide);

  await userEvent.click(screen.getByRole("button", { name: "Ablehnen" }));
  await userEvent.click(screen.getByRole("button", { name: "Annehmen" }));

  expect(onDecide.mock.calls).toEqual([["deny"], ["approve"]]);
});
