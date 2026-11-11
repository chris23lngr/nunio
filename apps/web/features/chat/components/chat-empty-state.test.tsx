import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ChatEmptyState } from "./chat-empty-state";

const prompts = [
  "Was habe ich heute noch in BWL1 zu tun?",
  "Erstelle mir Flashcards für FOF1",
];

test("greets the user by first name", () => {
  render(
    <ChatEmptyState firstName="Christoph" prompts={[]} onPrompt={() => {}} />,
  );

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Woran möchtest du heute arbeiten, Christoph?",
  );
});

test("offers each prompt as a button", () => {
  render(
    <ChatEmptyState
      firstName="Christoph"
      prompts={prompts}
      onPrompt={() => {}}
    />,
  );

  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(prompts);
});

test("clicking a prompt hands its text to onPrompt", async () => {
  const onPrompt = vi.fn();
  render(
    <ChatEmptyState
      firstName="Christoph"
      prompts={prompts}
      onPrompt={onPrompt}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", { name: "Erstelle mir Flashcards für FOF1" }),
  );

  expect(onPrompt.mock.calls).toEqual([["Erstelle mir Flashcards für FOF1"]]);
});

test("a prompt can be chosen with the keyboard", async () => {
  const onPrompt = vi.fn();
  render(
    <ChatEmptyState
      firstName="Christoph"
      prompts={prompts}
      onPrompt={onPrompt}
    />,
  );

  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  await userEvent.tab();
  await userEvent.keyboard(" ");

  expect(onPrompt.mock.calls).toEqual([[prompts[0]], [prompts[1]]]);
});
