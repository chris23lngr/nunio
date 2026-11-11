import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { Suggestion } from "./suggestions-sheet";
import { SuggestionsSheet } from "./suggestions-sheet";

const create: Suggestion = {
  id: "s1",
  kind: "create",
  title: "Lineare Algebra: Übungsblatt 4",
  start: new Date(2026, 10, 13, 9, 0),
  end: new Date(2026, 10, 13, 12, 0),
  needsApproval: false,
};

const move: Suggestion = {
  id: "s2",
  kind: "move",
  title: "Analysis: Klausurvorbereitung",
  start: new Date(2026, 10, 13, 15, 0),
  end: new Date(2026, 10, 13, 17, 0),
  needsApproval: false,
};

function renderSheet(props: Partial<Parameters<typeof SuggestionsSheet>[0]>) {
  return render(
    <SuggestionsSheet
      open
      onOpenChange={vi.fn()}
      suggestions={[]}
      onAccept={vi.fn()}
      {...props}
    />,
  );
}

test("the sheet says how many changes nunio suggests", () => {
  renderSheet({ suggestions: [create, move, { ...move, id: "s3" }] });

  const sheet = screen.getByRole("dialog", { name: "Änderungsvorschläge" });
  expect(sheet.textContent).toContain("nunio schlägt 3 Änderungen vor");
});

test("a single suggestion is described in the singular", () => {
  renderSheet({ suggestions: [create] });

  expect(screen.getByText("nunio schlägt 1 Änderung vor")).toBeTruthy();
});

test("a new Study Block shows when it is planned and can be accepted", async () => {
  const onAccept = vi.fn();
  renderSheet({ suggestions: [create], onAccept });

  const row = screen.getByRole("listitem");
  expect(within(row).getByText("Lineare Algebra: Übungsblatt 4")).toBeTruthy();
  expect(
    within(row).getByText("Neuer Block Fr., 13. Nov., 09:00–12:00"),
  ).toBeTruthy();
  await userEvent
    .setup()
    .click(within(row).getByRole("button", { name: "Annehmen" }));
  expect(onAccept).toHaveBeenCalledWith(create);
});

test("moving a Study Block nunio placed shows the new time and can be accepted", async () => {
  const onAccept = vi.fn();
  renderSheet({ suggestions: [move], onAccept });

  const row = screen.getByRole("listitem");
  expect(
    within(row).getByText("Verschieben auf Fr., 13. Nov., 15:00–17:00"),
  ).toBeTruthy();
  expect(within(row).queryByRole("button", { name: "Genehmigen" })).toBeNull();
  await userEvent
    .setup()
    .click(within(row).getByRole("button", { name: "Annehmen" }));
  expect(onAccept).toHaveBeenCalledWith(move);
});

test("moving a Study Block the student placed asks for approval", async () => {
  const onAccept = vi.fn();
  const own = { ...move, needsApproval: true };
  renderSheet({ suggestions: [own], onAccept });

  const row = screen.getByRole("listitem");
  expect(
    within(row).getByText(
      "Verschieben auf Fr., 13. Nov., 15:00–17:00 · dein Block",
    ),
  ).toBeTruthy();
  expect(within(row).queryByRole("button", { name: "Annehmen" })).toBeNull();
  await userEvent
    .setup()
    .click(within(row).getByRole("button", { name: "Genehmigen" }));
  expect(onAccept).toHaveBeenCalledWith(own);
});

test("suggestions can be rejected only when rejecting is offered", async () => {
  const onReject = vi.fn();
  const { unmount } = renderSheet({ suggestions: [create, move] });
  expect(screen.queryByRole("button", { name: "Ablehnen" })).toBeNull();
  unmount();

  renderSheet({ suggestions: [create, move], onReject });
  const moveRow = screen.getAllByRole("listitem")[1] as HTMLElement;
  await userEvent
    .setup()
    .click(within(moveRow).getByRole("button", { name: "Ablehnen" }));
  expect(onReject).toHaveBeenCalledWith(move);
});

test("while busy the suggestions cannot be acted on", () => {
  renderSheet({
    suggestions: [create],
    onReject: vi.fn(),
    onAcceptAll: vi.fn(),
    busy: true,
  });

  for (const name of ["Annehmen", "Ablehnen", "Alle übernehmen"]) {
    const button = screen.getByRole("button", {
      name,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  }
});

test("all suggestions can be accepted at once only when that is offered", async () => {
  const onAcceptAll = vi.fn();
  const { unmount } = renderSheet({ suggestions: [create, move] });
  expect(screen.queryByRole("button", { name: "Alle übernehmen" })).toBeNull();
  unmount();

  renderSheet({ suggestions: [create, move], onAcceptAll });
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Alle übernehmen" }));
  expect(onAcceptAll).toHaveBeenCalledTimes(1);
});

test("with no suggestions the sheet says everything is planned", () => {
  renderSheet({ suggestions: [], onAcceptAll: vi.fn() });

  expect(
    screen.getByText("Alles eingeplant. nunio hat gerade keine Vorschläge."),
  ).toBeTruthy();
  expect(screen.queryByText(/schlägt 0/)).toBeNull();
  expect(screen.queryByRole("listitem")).toBeNull();
  expect(screen.queryByRole("button", { name: "Alle übernehmen" })).toBeNull();
});
