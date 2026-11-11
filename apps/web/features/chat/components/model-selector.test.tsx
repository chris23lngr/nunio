import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ModelSelector } from "./model-selector";

const models = [
  {
    id: "opus",
    name: "Opus 5.5",
    provider: "Anthropic",
    description: "Das leistungsstärkste Modell für komplexe Aufgaben.",
  },
  {
    id: "sonnet",
    name: "Sonnet 5",
    provider: "Anthropic",
    description: "Ausgewogen zwischen Qualität und Geschwindigkeit.",
  },
];

test("trigger shows the current model", () => {
  render(<ModelSelector models={models} value="sonnet" />);
  const trigger = screen.getByRole("button", { name: "Modell: Sonnet 5" });
  expect(trigger.textContent).toBe("Sonnet 5");
});

test("menu lists every model and marks only the current one", async () => {
  const user = userEvent.setup();
  render(<ModelSelector models={models} value="sonnet" />);
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  const group = await screen.findByRole("group", { name: "Modelle" });
  const rows = within(group).getAllByRole("menuitem");
  expect(rows.map((row) => row.textContent)).toEqual(["Opus 5.5", "Sonnet 5"]);
  expect(rows.map((row) => row.getAttribute("aria-current"))).toEqual([
    null,
    "true",
  ]);
});

test("highlighting a row shows one info card for that model", async () => {
  const user = userEvent.setup();
  render(<ModelSelector models={models} value="sonnet" />);
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.hover(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  const card = await screen.findByRole("dialog", {
    name: "Anthropic / Opus 5.5",
  });
  expect(card.textContent).toContain(
    "Das leistungsstärkste Modell für komplexe Aufgaben.",
  );

  await user.keyboard("{ArrowDown}");
  await screen.findByRole("dialog", { name: "Anthropic / Sonnet 5" });
  expect(screen.getAllByRole("dialog").length).toBe(1);
  expect(screen.getByRole("dialog").textContent).toContain(
    "Ausgewogen zwischen Qualität und Geschwindigkeit.",
  );
});

test("Escape closes the menu and its card", async () => {
  const user = userEvent.setup();
  render(<ModelSelector models={models} value="sonnet" />);
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.hover(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBe(null));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
});

test("clicking another model does not change the current one", async () => {
  const user = userEvent.setup();
  render(<ModelSelector models={models} value="sonnet" />);
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.click(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  const rows = await screen.findAllByRole("menuitem");
  expect(rows.map((row) => row.getAttribute("aria-current"))).toEqual([
    null,
    "true",
  ]);
});
