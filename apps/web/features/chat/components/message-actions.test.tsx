import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MessageActions } from "./message-actions";

const createdAt = new Date(2026, 10, 11, 9, 48).toISOString();

test("shows when the message was sent as a German clock time", () => {
  render(<MessageActions createdAt={createdAt} text="Hallo" own={false} />);

  const time = screen.getByText("9:48 Uhr");
  expect(time.tagName).toBe("TIME");
  expect(time.getAttribute("datetime")).toBe(createdAt);
});

test("copying an answer puts its text on the clipboard and confirms it", async () => {
  const user = userEvent.setup();
  render(
    <MessageActions createdAt={createdAt} text="Die Antwort" own={false} />,
  );

  await user.click(screen.getByRole("button", { name: "Antwort kopieren" }));

  expect(await navigator.clipboard.readText()).toBe("Die Antwort");
  expect(screen.getByRole("status").textContent).toBe("Kopiert");
});

test("a failed copy says copying is not possible", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("denied"),
  );
  render(<MessageActions createdAt={createdAt} text="Hallo" own={false} />);

  await user.click(screen.getByRole("button", { name: "Antwort kopieren" }));

  expect(screen.getByRole("status").textContent).toBe("Kopieren nicht möglich");
});

test("the student's own message is copied as a message and offers a disabled edit", () => {
  render(<MessageActions createdAt={createdAt} text="Frage" own />);

  expect(
    screen.getByRole("button", { name: "Nachricht kopieren" }),
  ).toBeTruthy();
  const edit = screen.getByRole("button", {
    name: "Nachricht bearbeiten (noch nicht verfügbar)",
  }) as HTMLButtonElement;
  expect(edit.disabled).toBe(true);
});

test("an answer offers no edit", () => {
  render(<MessageActions createdAt={createdAt} text="Hallo" own={false} />);

  expect(screen.queryByRole("button", { name: /bearbeiten/ })).toBeNull();
});

test("a withdrawn answer has nothing to copy but keeps its time", () => {
  render(
    <MessageActions createdAt={createdAt} text="" own={false} withdrawn />,
  );

  expect(screen.queryByRole("button", { name: /kopieren/ })).toBeNull();
  expect(screen.getByText("9:48 Uhr")).toBeTruthy();
});

test("the footer lines up with the message text, without side padding", () => {
  const { container } = render(
    <MessageActions createdAt={createdAt} text="Hallo" own={false} />,
  );

  const footer = container.firstElementChild as HTMLElement;
  expect(footer.className).toContain("px-0");
  expect(footer.className).not.toContain("px-3");
});
