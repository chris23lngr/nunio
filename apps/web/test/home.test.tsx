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

test("a Shortfall offers skipping each Routine until its deadline by its series, which the student chooses", async () => {
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
              routine: "s-tut",
              title: "OM Tutorium",
              until,
              gainedMinutes: 60,
            },
            {
              kind: "skip_routine",
              routine: "s-om",
              title: "OM Vorlesung",
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

  expect(
    await screen.findByText(/OM Tutorium until then \(1 h\)/),
  ).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "„OM Vorlesung“ aussetzen" }),
  );

  await waitFor(() => expect(skipped).toEqual({ until }));
});

test("a Routine that cannot be skipped says so and keeps the day in view", async () => {
  const until = "2026-11-20T17:00:00.000Z";
  api.route(
    "POST",
    "/api/me/event-series/s-om/routine/skip",
    () => new Response(null, { status: 500 }),
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
              title: "OM Vorlesung",
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
    await screen.findByRole("button", { name: "„OM Vorlesung“ aussetzen" }),
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not skip the Routine.",
  );
  expect(
    screen.getByRole("heading", { name: "Needs your attention" }),
  ).toBeTruthy();
});

test("says when nothing is ready", async () => {
  serveHome([]);

  const section = await screen.findByRole("region", { name: "Ready for you" });
  expect(within(section).getByText("Nothing new from nunio yet.")).toBeTruthy();
});
