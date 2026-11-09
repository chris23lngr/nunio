import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { BriefingSettings } from "@/features/inbox/briefing-settings";
import { EmailSettings } from "@/features/inbox/email-settings";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { QuietSettings } from "@/features/inbox/quiet-settings";
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

test("a Briefing lists what it bundled when it was made", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [{ ...expired, state: "acknowledged" }],
      briefings: [
        {
          id: "b-1",
          madeAt: "2026-11-10T06:05:00.000Z",
          interventions: [expired.id],
          approvals: [],
          responsibilities: [
            {
              id: "r-1",
              preset: "keep_course_organized",
              course: "Analysis I",
              exam: null,
            },
          ],
        },
      ],
    }),
  );
  render(
    <TestProviders>
      <InboxScreen apiOrigin={api.origin} />
    </TestProviders>,
  );

  const briefings = await screen.findByRole("region", { name: "Briefings" });
  const [briefing] = within(briefings).getAllByRole("article");
  expect(
    within(briefing!).getByText(
      "An approval expired: move the block for Problem sheet 1",
    ),
  ).toBeTruthy();
  expect(within(briefing!).getByText("Keep Analysis I organized")).toBeTruthy();
});

test("the student moves the daily Briefing, or turns it off", async () => {
  const patches: unknown[] = [];
  let settings: { briefingAtMinute: number | null; email: boolean } = {
    briefingAtMinute: 420,
    email: true,
  };
  api.route("GET", "/api/me/outreach-settings", () => Response.json(settings));
  api.route("PATCH", "/api/me/outreach-settings", async (request) => {
    const patch = (await request.json()) as typeof settings;
    patches.push(patch);
    settings = { ...settings, ...patch };
    return Response.json(settings);
  });
  const user = userEvent.setup();
  render(
    <TestProviders>
      <BriefingSettings apiOrigin={api.origin} />
    </TestProviders>,
  );

  const time = await screen.findByLabelText("Daily Briefing at");
  expect((time as HTMLInputElement).value).toBe("07:00");
  await user.clear(time);
  await user.type(time, "08:30");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", { name: "Turn Briefings off" }),
  );

  expect(patches).toEqual([
    { briefingAtMinute: 510 },
    { briefingAtMinute: null },
  ]);
  expect(
    await screen.findByRole("button", { name: "Turn Briefings on" }),
  ).toBeTruthy();
});

test("the student turns email off and on again", async () => {
  const patches: unknown[] = [];
  let settings = { briefingAtMinute: 420, email: true };
  api.route("GET", "/api/me/outreach-settings", () => Response.json(settings));
  api.route("PATCH", "/api/me/outreach-settings", async (request) => {
    const patch = (await request.json()) as Partial<typeof settings>;
    patches.push(patch);
    settings = { ...settings, ...patch };
    return Response.json(settings);
  });
  const user = userEvent.setup();
  render(
    <TestProviders>
      <EmailSettings apiOrigin={api.origin} />
    </TestProviders>,
  );

  const email = await screen.findByRole("checkbox", {
    name: "Email me when something needs my attention",
  });
  expect((email as HTMLInputElement).checked).toBe(true);
  await user.click(email);
  await waitFor(() => expect((email as HTMLInputElement).checked).toBe(false));
  await user.click(email);

  await waitFor(() =>
    expect(patches).toEqual([{ email: false }, { email: true }]),
  );
});

test("the student sets Quiet Hours across midnight, turns them off, and changes the daily limit", async () => {
  const patches: unknown[] = [];
  let settings: {
    briefingAtMinute: number | null;
    email: boolean;
    quietHours: { fromMinute: number; toMinute: number } | null;
    dailyLimit: number;
  } = { briefingAtMinute: 420, email: true, quietHours: null, dailyLimit: 3 };
  api.route("GET", "/api/me/outreach-settings", () => Response.json(settings));
  api.route("PATCH", "/api/me/outreach-settings", async (request) => {
    const patch = (await request.json()) as Partial<typeof settings>;
    patches.push(patch);
    settings = { ...settings, ...patch };
    return Response.json(settings);
  });
  const user = userEvent.setup();
  render(
    <TestProviders>
      <QuietSettings apiOrigin={api.origin} />
    </TestProviders>,
  );

  await user.click(
    await screen.findByRole("button", { name: "Turn Quiet Hours on" }),
  );
  const from = await screen.findByLabelText("Quiet from");
  const until = screen.getByLabelText("until");
  await user.clear(from);
  await user.type(from, "22:00");
  await user.clear(until);
  await user.type(until, "07:00");
  await user.click(screen.getByRole("button", { name: "Save Quiet Hours" }));
  await user.click(
    await screen.findByRole("button", { name: "Turn Quiet Hours off" }),
  );
  const limit = screen.getByLabelText("At most this many alerts a day");
  await user.clear(limit);
  await user.type(limit, "5");
  await user.click(screen.getByRole("button", { name: "Save limit" }));

  await waitFor(() =>
    expect(patches).toEqual([
      { quietHours: { fromMinute: 1320, toMinute: 420 } },
      { quietHours: null },
      { dailyLimit: 5 },
    ]),
  );
});
