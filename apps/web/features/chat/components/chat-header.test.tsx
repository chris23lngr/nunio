import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ChatHeader } from "./chat-header";

test("the header is a banner landmark showing its content in order", () => {
  render(
    <ChatHeader>
      <button type="button">Sidebar öffnen</button>
      <button type="button">Modell wählen</button>
    </ChatHeader>,
  );

  const header = screen.getByRole("banner");
  const labels = Array.from(header.querySelectorAll("button")).map(
    (button) => button.textContent,
  );
  expect(labels).toEqual(["Sidebar öffnen", "Modell wählen"]);
});

test("the header has no title", () => {
  render(
    <ChatHeader>
      <button type="button">Modell wählen</button>
    </ChatHeader>,
  );

  expect(screen.queryByRole("heading")).toBeNull();
});

test("a consumer can add classes without losing the header's own", () => {
  render(<ChatHeader className="custom-class" />);

  const classes = screen.getByRole("banner").className.split(" ");
  expect(classes).toContain("custom-class");
  expect(classes).toContain("h-16");
});
