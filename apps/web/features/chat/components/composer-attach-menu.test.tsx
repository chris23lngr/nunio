import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ComposerAttachMenu } from "./composer-attach-menu";

test("the menu offers uploads and connectors, both enabled", async () => {
  render(<ComposerAttachMenu />);

  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Weitere Optionen" }));

  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Datei hochladen",
    "Konnektoren verwalten",
  ]);
  for (const item of items)
    expect(item.getAttribute("aria-disabled")).toBeNull();
});

test("the trigger doesn't submit the surrounding form", () => {
  render(
    <form>
      <ComposerAttachMenu />
    </form>,
  );

  expect(
    screen
      .getByRole("button", { name: "Weitere Optionen" })
      .getAttribute("type"),
  ).toBe("button");
});
