import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const expired = {
  id: "5c1e0a4e-0000-4000-8000-000000000001",
  kind: "approval_expired",
  title: "Problem sheet 1",
  course: "Analysis I" as string | null,
  shortMinutes: null as number | null,
  action: {
    kind: "studyBlock.move",
    work: { title: "Problem sheet 1", course: "Analysis I" },
    from: {
      start: "2026-11-17T09:00:00.000Z",
      end: "2026-11-17T10:00:00.000Z",
    },
    to: { start: "2026-11-18T14:00:00.000Z", end: "2026-11-18T15:00:00.000Z" },
  },
  raisedAt: "2026-11-10T07:00:00.000Z",
  state: "open",
  closedAt: null as string | null,
};

/** Serves one Intervention and records how the student closes it. */
function serveInbox() {
  let intervention = expired;
  const closings: unknown[] = [];
  api.route("GET", "/api/me/inbox", () =>
    Response.json({ interventions: [intervention] }),
  );
  api.route("POST", `/api/me/interventions/${expired.id}`, async (request) => {
    const body = (await request.json()) as { as: string };
    closings.push(body);
    intervention = {
      ...intervention,
      state: body.as,
      closedAt: "2026-11-10T08:00:00.000Z",
    };
    return Response.json({ status: "ok" });
  });
  render(
    <TestProviders>
      <InboxScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
  return closings;
}

test("dismissing records that the Intervention was not useful, and closes it", async () => {
  const closings = serveInbox();
  const open = await screen.findByRole("region", { name: "Needs attention" });
  const item = within(open).getByRole("article", {
    name: /approval expired.*Problem sheet 1/i,
  });

  await userEvent.click(
    within(item).getByRole("button", { name: "Not useful" }),
  );

  expect(closings).toEqual([{ as: "dismissed" }]);
  const closed = await screen.findByRole("region", { name: "Closed" });
  expect(
    await within(closed).findByText(/Dismissed as not useful/),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
});

test("acknowledging records only that the student noted it", async () => {
  const closings = serveInbox();
  const item = await screen.findByRole("article", {
    name: /approval expired.*Problem sheet 1/i,
  });

  await userEvent.click(within(item).getByRole("button", { name: "Got it" }));

  expect(closings).toEqual([{ as: "acknowledged" }]);
  const closed = await screen.findByRole("region", { name: "Closed" });
  expect(await within(closed).findByText(/Acknowledged/)).toBeTruthy();
});

test("a Shortfall says how much time is missing before its work is due", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        {
          ...expired,
          kind: "shortfall",
          title: "Problem sheet 3",
          action: null,
          shortMinutes: 600,
        },
      ],
    }),
  );
  render(
    <TestProviders>
      <InboxScreen apiOrigin={api.origin} />
    </TestProviders>,
  );

  expect(
    await screen.findByRole("article", {
      name: "10 h short for Problem sheet 3",
    }),
  ).toBeTruthy();
});

test("a lapsed Intervention says it no longer applies and cannot be closed", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        {
          ...expired,
          kind: "disagreement",
          title: "Room 101",
          action: null,
          state: "lapsed",
          closedAt: "2026-11-10T08:00:00.000Z",
        },
      ],
    }),
  );
  render(
    <TestProviders>
      <InboxScreen apiOrigin={api.origin} />
    </TestProviders>,
  );

  const closed = await screen.findByRole("region", { name: "Closed" });
  const item = within(closed).getByRole("article", {
    name: "Sources disagree about Room 101",
  });
  expect(within(item).getByText("No longer applies")).toBeTruthy();
  expect(within(item).queryByRole("button")).toBeNull();
});
