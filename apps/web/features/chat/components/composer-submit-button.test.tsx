import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ComposerSubmitButton } from "./composer-submit-button";

const noop = () => {};

test("with nothing to send the send button is disabled", () => {
  render(<ComposerSubmitButton busy={false} disabled onStop={noop} />);

  const button = screen.getByRole("button", {
    name: "Nachricht senden",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

test("with something to send the button submits its form", async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <ComposerSubmitButton busy={false} disabled={false} onStop={noop} />
    </form>,
  );

  const button = screen.getByRole("button", {
    name: "Nachricht senden",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  await userEvent.setup().click(button);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("while busy the button stops the answer instead of submitting", async () => {
  const onStop = vi.fn();
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <ComposerSubmitButton busy disabled onStop={onStop} />
    </form>,
  );

  expect(screen.queryByRole("button", { name: "Nachricht senden" })).toBeNull();
  const stop = screen.getByRole("button", {
    name: "Antwort stoppen",
  }) as HTMLButtonElement;
  expect(stop.disabled).toBe(false);
  await userEvent.setup().click(stop);
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
});
