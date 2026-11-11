import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createRef, useState } from "react";
import { expect, test, vi } from "vitest";
import { ChatComposer } from "./chat-composer";

/** The composer with its value kept in state, as ChatScreen keeps it in its form. */
function Composer({
  initial = "",
  ...props
}: Partial<ComponentProps<typeof ChatComposer>> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ChatComposer
      value={value}
      onValueChange={setValue}
      onSubmit={() => {}}
      busy={false}
      canSend={!!value.trim()}
      onStop={() => {}}
      {...props}
    />
  );
}

const textbox = () =>
  screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement;

test("Enter submits the message", async () => {
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} />);

  await userEvent.setup().type(textbox(), "Hallo{Enter}");

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(textbox().value).toBe("Hallo");
});

test("Shift+Enter adds a newline instead of submitting", async () => {
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} />);

  await userEvent.setup().type(textbox(), "a{Shift>}{Enter}{/Shift}b");

  expect(onSubmit).not.toHaveBeenCalled();
  expect(textbox().value).toBe("a\nb");
});

test("Alt+Enter inserts a newline at the caret instead of submitting", async () => {
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} initial="ab" />);
  const user = userEvent.setup();

  await user.click(textbox());
  textbox().setSelectionRange(1, 1);
  await user.keyboard("{Alt>}{Enter}{/Alt}");

  expect(onSubmit).not.toHaveBeenCalled();
  expect(textbox().value).toBe("a\nb");
  expect(textbox().selectionStart).toBe(2);
  expect(textbox().selectionEnd).toBe(2);
});

test("Alt+Enter replaces the selected text with a newline", async () => {
  render(<Composer initial="abcd" />);
  const user = userEvent.setup();

  await user.click(textbox());
  textbox().setSelectionRange(1, 3);
  await user.keyboard("{Alt>}{Enter}{/Alt}");

  expect(textbox().value).toBe("a\nd");
  expect(textbox().selectionStart).toBe(2);
});

test("Enter while composing with an IME doesn't submit", () => {
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} initial="か" />);

  fireEvent.keyDown(textbox(), { key: "Enter", isComposing: true });

  expect(onSubmit).not.toHaveBeenCalled();
});

test("Enter doesn't submit while an answer is being written", async () => {
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} busy />);

  await userEvent.setup().type(textbox(), "Nächste Frage{Enter}");

  expect(onSubmit).not.toHaveBeenCalled();
  expect(textbox().value).toBe("Nächste Frage");
});

test("the knowledge slot sits in the bar between the + menu and the send button", () => {
  render(<Composer knowledge={<button type="button">Wissen wählen</button>} />);

  const bar = screen.getByRole("button", { name: "Wissen wählen" })
    .parentElement as HTMLElement;
  const labels = Array.from(bar.querySelectorAll("button")).map(
    (button) => button.getAttribute("aria-label") ?? button.textContent,
  );
  expect(labels).toEqual([
    "Weitere Optionen",
    "Wissen wählen",
    "Nachricht senden",
  ]);
});

test("an alert is announced above the box", () => {
  const { rerender } = render(<Composer />);
  expect(screen.queryByRole("alert")).toBeNull();

  rerender(<Composer alert="Antwort gestoppt." />);

  expect(screen.getByRole("alert").textContent).toBe("Antwort gestoppt.");
});

test("the send button submits when something can be sent", async () => {
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} />);
  const user = userEvent.setup();
  const send = () =>
    screen.getByRole("button", {
      name: "Nachricht senden",
    }) as HTMLButtonElement;

  expect(send().disabled).toBe(true);
  await user.type(textbox(), "Hallo");
  await user.click(send());

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("while busy the button stops the answer", async () => {
  const onStop = vi.fn();
  render(<Composer busy onStop={onStop} />);

  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Antwort stoppen" }));

  expect(onStop).toHaveBeenCalledTimes(1);
});

test("the message field keeps its limit, hint and description", () => {
  const ref = createRef<HTMLTextAreaElement>();
  render(
    <Composer textareaRef={ref} aria-describedby="chat-scope-description" />,
  );

  expect(
    screen.getByRole("form", { name: "Nachricht verfassen" }),
  ).toBeTruthy();
  expect(ref.current).toBe(textbox());
  expect(textbox().maxLength).toBe(4000);
  expect(textbox().placeholder).toBe(
    "Frage nunio alles, erwähne Kurse und Dateien mit @",
  );
  expect(textbox().getAttribute("aria-describedby")).toBe(
    "chat-scope-description",
  );
});

test("Alt+Enter doesn't push the message over its limit", async () => {
  render(<Composer initial={"a".repeat(4000)} />);
  const user = userEvent.setup();

  await user.click(textbox());
  await user.keyboard("{Alt>}{Enter}{/Alt}");

  expect(textbox().value).toBe("a".repeat(4000));
});
