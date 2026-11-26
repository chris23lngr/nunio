import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { ConnectionOption } from "./connection-selector";
import { ConnectionSelector } from "./connection-selector";

const email: ConnectionOption = { key: "email", name: "E-Mail" };
const notes: ConnectionOption = { key: "testnotizen", name: "Testnotizen" };

function mount(props: Partial<Parameters<typeof ConnectionSelector>[0]> = {}) {
  const toggled: string[] = [];
  render(
    <ConnectionSelector
      connections={[email, notes]}
      selected={[]}
      onToggle={(key) => toggled.push(key)}
      {...props}
    />,
  );
  return toggled;
}

test("the chip reads Verbindungen while none is switched on", () => {
  mount();
  expect(screen.getByRole("button", { name: "Verbindungen" }).textContent).toBe(
    "Verbindungen",
  );
});

test("the chip names the Connections switched on", () => {
  mount({ selected: ["email", "testnotizen"] });
  expect(
    screen.getByRole("button", {
      name: "Verbindungen, eingeschaltet: E-Mail, Testnotizen",
    }).textContent,
  ).toBe("E-Mail, Testnotizen");
});

test("the popover says only what is switched on here can be read, with one switch per Connection", async () => {
  const user = userEvent.setup();
  mount({ selected: ["testnotizen"] });
  await user.click(screen.getByRole("button", { name: /Verbindungen/ }));

  const group = await screen.findByRole("group", {
    name: "Verbindungen in diesem Chat",
  });
  expect(
    within(group).getByText("Nur was du hier einschaltest, kann nunio lesen."),
  ).toBeTruthy();
  const rows = within(group).getAllByRole("menuitemcheckbox");
  expect(rows.map((row) => row.textContent)).toEqual(["E-Mail", "Testnotizen"]);
  expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
    "false",
    "true",
  ]);
});

test("switching a Connection reports its Integration and keeps the popover open", async () => {
  const user = userEvent.setup();
  const toggled = mount();
  await user.click(screen.getByRole("button", { name: "Verbindungen" }));
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: "E-Mail" }),
  );

  expect(toggled).toEqual(["email"]);
  expect(screen.getByRole("menu")).toBeTruthy();
});

test("the popover ends with a link to Einstellungen › Verbindungen", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Verbindungen" }));

  const items = await screen.findAllByRole("menuitem");
  expect(items.at(-1)!.textContent).toBe("Integrationen verwalten");
  expect(items.at(-1)!.getAttribute("href")).toBe("/settings/connections");
});

test("the popover says when the student has no Connection yet", async () => {
  const user = userEvent.setup();
  mount({ connections: [] });
  await user.click(screen.getByRole("button", { name: "Verbindungen" }));

  expect(await screen.findByText("Noch keine Verbindungen.")).toBeTruthy();
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
});

test("the popover shows why a change didn't save", async () => {
  const user = userEvent.setup();
  mount({ error: "Die Verbindungen konnten nicht gespeichert werden." });
  await user.click(screen.getByRole("button", { name: "Verbindungen" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Die Verbindungen konnten nicht gespeichert werden.",
  );
});
