import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { SeriesReview } from "@/app/(app)/review/series-review";
import { api } from "./api";

const course = (id: string, title: string) => ({
  id,
  code: null,
  title,
  status: "accepted",
  archived: false,
  obligations: [],
  facts: [],
});
const series = (
  id: string,
  title: string,
  state: string,
  courseId: string | null,
) => ({ id, calendarId: "cal-1", title, courseId, state });
let decisions: [string, unknown][] = [];
let routines: [string, unknown][] = [];

beforeEach(() => {
  decisions = [];
  routines = [];
  api.route("GET", "/api/me/review", () =>
    Response.json({
      courses: [
        course("om", "Operations Management"),
        course("an", "Analysis I"),
      ],
    }),
  );
  api.route("GET", "/api/me/plan", () =>
    Response.json({
      eventSeries: [
        series("s-om", "OM Vorlesung", "proposed", "om"),
        series("s-yoga", "Yoga", "undecided", null),
        series("s-an", "Analysis Vorlesung", "confirmed", "an"),
      ],
    }),
  );
  for (const id of ["s-om", "s-yoga"]) {
    api.route(
      "POST",
      `/api/me/event-series/${id}/decision`,
      async (request) => {
        decisions.push([id, await request.json()]);
        return Response.json({ status: "ok" });
      },
    );
    api.route("PUT", `/api/me/event-series/${id}/routine`, async (request) => {
      routines.push([id, await request.json()]);
      return Response.json({ status: "ok" });
    });
  }
});

test("Review shows the Course nunio proposed for a calendar series, and confirms it", async () => {
  render(<SeriesReview apiOrigin={api.origin} />);
  const row = await screen.findByRole("group", { name: "OM Vorlesung" });
  expect(
    within(row).getByText("Vorschlag: Operations Management"),
  ).toBeTruthy();
  // A confirmed series is no longer up for review.
  expect(
    screen.queryByRole("group", { name: "Analysis Vorlesung" }),
  ).toBeNull();

  await userEvent.click(
    within(row).getByRole("button", { name: "Bestätigen" }),
  );

  await waitFor(() =>
    expect(decisions).toEqual([["s-om", { courseId: "om" }]]),
  );
});

test("Review lets the student pick another Course for a series, or say it belongs to none", async () => {
  const user = userEvent.setup();
  render(<SeriesReview apiOrigin={api.origin} />);
  const yoga = await screen.findByRole("group", { name: "Yoga" });

  await user.click(within(yoga).getByRole("combobox", { name: "Kurs" }));
  await user.click(await screen.findByRole("option", { name: "Analysis I" }));
  await user.click(within(yoga).getByRole("button", { name: "Bestätigen" }));
  await user.click(
    within(screen.getByRole("group", { name: "OM Vorlesung" })).getByRole(
      "button",
      { name: "Kein Kurs" },
    ),
  );

  await waitFor(() =>
    expect(decisions).toEqual([
      ["s-yoga", { courseId: "an" }],
      ["s-om", { reject: true }],
    ]),
  );
});

test("confirming a series sets its Routine too, with the minutes the student chose", async () => {
  const user = userEvent.setup();
  render(<SeriesReview apiOrigin={api.origin} />);
  const row = await screen.findByRole("group", { name: "OM Vorlesung" });
  const followUp = within(row).getByRole("spinbutton", {
    name: "Nachbereitung (Minuten)",
  });
  expect(
    within(row).getByRole("spinbutton", { name: "Vorbereitung (Minuten)" }),
  ).toHaveProperty("value", "30");

  await user.clear(followUp);
  await user.type(followUp, "90");
  await user.click(within(row).getByRole("button", { name: "Bestätigen" }));

  await waitFor(() =>
    expect(routines).toEqual([
      ["s-om", { preparationMinutes: 30, followUpMinutes: 90 }],
    ]),
  );
  expect(decisions).toEqual([["s-om", { courseId: "om" }]]);
});
