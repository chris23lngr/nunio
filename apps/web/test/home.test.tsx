import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("a Shortfall offers skipping a Routine until its deadline, which the student chooses", async () => {
  const until = "2026-11-20T17:00:00.000Z";
  let skipped: unknown;
  api.route(
    "POST",
    "/api/me/event-series/s-om/routine/skip",
    async (request) => {
      skipped = await request.json();
      return Response.json({ status: "ok" });
    },
  );
  api.route("GET", "/api/me/home", () =>
    Response.json({
      attention: [
        {
          kind: "shortfall",
          workId: "exam",
          title: "Klausur Statistik",
          course: "Statistics II",
          due: until,
          shortMinutes: 240,
          unreviewed: false,
          tradeoffs: [
            {
              kind: "skip_routine",
              routine: "s-om",
              until,
              gainedMinutes: 180,
            },
          ],
        },
      ],
      ongoing: [],
      artifacts: [],
      agentWork: [],
    }),
  );
  render(<HomeView apiOrigin={api.origin} />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Routine aussetzen" }),
  );

  await waitFor(() => expect(skipped).toEqual({ until }));
});

test("says when nothing is ready", async () => {
  serveHome([]);

  const section = await screen.findByRole("region", { name: "Ready for you" });
  expect(within(section).getByText("Nothing new from nunio yet.")).toBeTruthy();
});
