import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SuggestionsButton } from "./suggestions-button";

test("with new suggestions the button names how many and shows the count", async () => {
  const onClick = vi.fn();
  render(<SuggestionsButton count={3} onClick={onClick} />);

  const button = screen.getByRole("button", {
    name: "Vorschläge anzeigen, 3 neu",
  });
  expect(button.textContent).toContain("3");
  await userEvent.setup().click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("with new suggestions a dot hidden from assistive tech marks the button", () => {
  const { container } = render(
    <SuggestionsButton count={1} onClick={vi.fn()} />,
  );

  const dot = container.querySelector("[data-slot=suggestions-dot]");
  expect(dot?.getAttribute("aria-hidden")).toBe("true");
});

test("with no suggestions the button shows neither count nor dot", () => {
  const { container } = render(
    <SuggestionsButton count={0} onClick={vi.fn()} />,
  );

  const button = screen.getByRole("button", { name: "Vorschläge anzeigen" });
  expect(button.textContent).toBe("Vorschläge anzeigen");
  expect(container.querySelector("[data-slot=suggestions-dot]")).toBeNull();
});
