import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ChatEmptyState } from "./chat-empty-state";

test("greets the user by first name", () => {
  render(<ChatEmptyState firstName="Christoph" recent={[]} more={false} />);

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Woran möchtest du heute arbeiten, Christoph?",
  );
});
