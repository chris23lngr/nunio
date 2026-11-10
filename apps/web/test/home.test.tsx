import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { HomeView } from "@/app/(app)/home-view";
import { api } from "./api";

const ready = (id: string, kind: string) => ({
  id,
  kind,
  status: "ready",
  failure: null,
  topicIds: [],
  obligationId: null,
  createdAt: "2026-11-10T09:00:00.000Z",
  openedAt: null,
  withdrawn: false,
});

function serveHome(artifacts: unknown[]) {
  api.route("GET", "/api/me/home", () =>
    Response.json({ attention: [], ongoing: [], artifacts, agentWork: [] }),
  );
  render(<HomeView apiOrigin={api.origin} />);
}

test("lists the Artifacts nunio made that the student has not opened yet", async () => {
  serveHome([ready("a1", "practice_set"), ready("a2", "flashcards")]);

  const section = await screen.findByRole("region", { name: "Ready for you" });
  const links = within(section).getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["Practice set", "/study/artifacts/a1"],
    ["Flashcards", "/study/artifacts/a2"],
  ]);
});

test("says when nothing is ready", async () => {
  serveHome([]);

  const section = await screen.findByRole("region", { name: "Ready for you" });
  expect(within(section).getByText("Nothing new from nunio yet.")).toBeTruthy();
});
