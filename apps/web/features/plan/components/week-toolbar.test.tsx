import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { DisplayOptions } from "./week-toolbar";
import { WeekToolbar } from "./week-toolbar";

const today = new Date(2026, 10, 11);
const display: DisplayOptions = {
  weekends: true,
  suggestions: false,
  protectedTime: true,
  calendar: false,
};

function renderToolbar(week = today) {
  const onWeekChange = vi.fn();
  const onDisplayChange = vi.fn();
  render(
    <WeekToolbar
      week={week}
      today={today}
      onWeekChange={onWeekChange}
      display={display}
      onDisplayChange={onDisplayChange}
    />,
  );
  return { onWeekChange, onDisplayChange };
}

test("shows the label of the shown week", () => {
  renderToolbar(new Date(2026, 11, 3));
  expect(screen.getByText("KW49, 30. Nov – 6. Dez")).toBeTruthy();
});

test("previous and next go one week back and forward", async () => {
  const user = userEvent.setup();
  const { onWeekChange } = renderToolbar();
  await user.click(screen.getByRole("button", { name: "Vorherige Woche" }));
  await user.click(screen.getByRole("button", { name: "Nächste Woche" }));
  expect(onWeekChange.mock.calls).toEqual([
    [new Date(2026, 10, 4)],
    [new Date(2026, 10, 18)],
  ]);
});

test("Heute goes to the week containing today", async () => {
  const { onWeekChange } = renderToolbar(new Date(2026, 11, 3));
  await userEvent.setup().click(screen.getByRole("button", { name: "Heute" }));
  expect(onWeekChange).toHaveBeenCalledWith(today);
});

test("Heute is disabled while the current week is shown", () => {
  renderToolbar(new Date(2026, 10, 15));
  expect(
    (screen.getByRole("button", { name: "Heute" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("the Anzeige menu shows each display option checked as it is set", async () => {
  renderToolbar();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Anzeige" }));
  const group = await screen.findByRole("group", { name: "Anzeige" });
  const items = within(group).getAllByRole("menuitemcheckbox");
  expect(
    items.map((item) => [item.textContent, item.getAttribute("aria-checked")]),
  ).toEqual([
    ["Wochenenden", "true"],
    ["Vorschläge", "false"],
    ["Blockierzeiten", "true"],
    ["Mein Kalender", "false"],
  ]);
});

test("toggling a display option flips only that option and keeps the menu open", async () => {
  const user = userEvent.setup();
  const { onDisplayChange } = renderToolbar();
  await user.click(screen.getByRole("button", { name: "Anzeige" }));
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: "Vorschläge" }),
  );
  expect(onDisplayChange).toHaveBeenCalledWith({
    ...display,
    suggestions: true,
  });
  expect(screen.getByRole("menu")).toBeTruthy();
});
