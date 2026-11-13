import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/test/api";
import { TestProviders } from "@/test/providers";
import type { Plan } from "./api/plan-queries";
import { PlanScreen } from "./plan-screen";

vi.mock("next/navigation", () => ({ usePathname: () => "/plan" }));

const today = new Date(2026, 10, 11, 8, 0);
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).toISOString();

const exam = {
  id: "ob-1",
  courseId: "c-stats",
  course: "Statistics II",
  title: "Klausur Statistics II",
  kind: "exam" as const,
  state: "confirmed" as const,
  reportedSubmittedAt: null,
  due: at(18, 9),
  estimate: { minutes: 1200, estimatedBy: "nunio" as const, rationale: null },
};

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    obligations: [exam],
    tasks: [],
    studyBlocks: [
      {
        id: "b-1",
        work: { kind: "obligation", id: "ob-1" },
        start: at(13, 9),
        end: at(13, 11),
        placedBy: "nunio",
        locked: false,
      },
    ],
    fixedEvents: [],
    eventSeries: [],
    calendars: [],
    priorities: [],
    limits: {
      preferences: {
        timeZone: "Europe/Berlin",
        studyFromMinute: 8 * 60,
        studyToMinute: 20 * 60,
        maxMinutesPerDay: 240,
      },
      courses: [],
      protectedTime: [],
    },
    proposal: { moves: [], unplanned: [], shortfalls: [], overlaps: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      courses: [
        {
          id: "c-stats",
          title: "Statistics II",
          code: null,
          status: "accepted",
          color: "fuchsia",
        },
      ],
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function mount(data: Plan = plan()) {
  api.route("GET", "/api/me/plan", () => Response.json(data));
  return render(
    <TestProviders>
      <SidebarProvider>
        <PlanScreen apiOrigin={api.origin} today={today} />
      </SidebarProvider>
    </TestProviders>,
  );
}

test("the Plan shows the current week with each Study Block on its day", async () => {
  mount();

  expect(
    await screen.findByRole("heading", { name: "Dein Plan" }),
  ).toBeTruthy();
  expect(screen.getByText("KW46, 9.–15. Nov")).toBeTruthy();
  const friday = await screen.findByRole("group", {
    name: "Freitag, 13. November",
  });
  expect(
    within(friday).getByRole("button", {
      name: "Klausur Statistics II, 09:00–11:00",
    }),
  ).toBeTruthy();
});

test("the student moves between weeks and sees that week's Study Blocks", async () => {
  mount(
    plan({
      studyBlocks: [
        {
          id: "b-1",
          work: { kind: "obligation", id: "ob-1" },
          start: at(13, 9),
          end: at(13, 11),
          placedBy: "nunio",
          locked: false,
        },
        {
          id: "b-2",
          work: { kind: "obligation", id: "ob-1" },
          start: at(17, 14),
          end: at(17, 16),
          placedBy: "nunio",
          locked: false,
        },
      ],
    }),
  );
  const user = userEvent.setup();
  await screen.findByRole("button", {
    name: "Klausur Statistics II, 09:00–11:00",
  });

  await user.click(screen.getByRole("button", { name: "Nächste Woche" }));

  expect(screen.getByText("KW47, 16.–22. Nov")).toBeTruthy();
  expect(
    within(
      screen.getByRole("group", { name: "Dienstag, 17. November" }),
    ).getByRole("button", { name: "Klausur Statistics II, 14:00–16:00" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", {
      name: "Klausur Statistics II, 09:00–11:00",
    }),
  ).toBeNull();
});

const create = {
  kind: "create" as const,
  workId: "ob-1",
  start: at(12, 9),
  end: at(12, 12),
  needsApproval: false,
};
const withSuggestion = plan({
  proposal: { moves: [create], unplanned: [], shortfalls: [], overlaps: [] },
});

test("accepting a suggestion applies that move and reloads the Plan", async () => {
  const applied: unknown[] = [];
  let current = withSuggestion;
  api.route("GET", "/api/me/plan", () => Response.json(current));
  api.route("POST", "/api/me/plan/apply", async (request) => {
    applied.push(await request.json());
    current = plan();
    return new Response(null, { status: 204 });
  });
  render(
    <TestProviders>
      <SidebarProvider>
        <PlanScreen apiOrigin={api.origin} today={today} />
      </SidebarProvider>
    </TestProviders>,
  );
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Vorschläge anzeigen, 1 neu" }),
  );
  const sheet = await screen.findByRole("dialog", {
    name: "Änderungsvorschläge",
  });
  await user.click(within(sheet).getByRole("button", { name: "Annehmen" }));

  expect(applied).toEqual([create]);
  expect(
    await within(sheet).findByRole("heading", { name: "Keine Vorschläge" }),
  ).toBeTruthy();
  expect(
    (
      within(sheet).getByRole("button", {
        name: "Alle übernehmen",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("a Study Block opens its details, where the student can Lock it", async () => {
  const locks: unknown[] = [];
  api.route("POST", "/api/me/study-blocks/b-1/lock", async (request) => {
    locks.push(await request.json());
    return new Response(null, { status: 204 });
  });
  mount();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", {
      name: "Klausur Statistics II, 09:00–11:00",
    }),
  );
  const details = await screen.findByRole("dialog");
  expect(
    within(details).getByText("Lernblock, von nunio geplant"),
  ).toBeTruthy();
  expect(
    within(details).getByText("Fällig Mittwoch, 18.11. · in 7 Tagen"),
  ).toBeTruthy();
  await user.click(within(details).getByRole("button", { name: "Sperren" }));

  expect(locks).toEqual([{ locked: true }]);
});

test("deleting a Study Block removes it through the API and closes its details", async () => {
  let deleted = false;
  api.route("DELETE", "/api/me/study-blocks/b-1", () => {
    deleted = true;
    return new Response(null, { status: 204 });
  });
  mount();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", {
      name: "Klausur Statistics II, 09:00–11:00",
    }),
  );
  const details = await screen.findByRole("dialog");
  await user.click(within(details).getByRole("button", { name: "Löschen" }));

  expect(deleted).toBe(true);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

const sundayOff = {
  ...plan().limits,
  protectedTime: [{ id: "sun", weekday: 7, fromMinute: 0, toMinute: 24 * 60 }],
};

test("Protected Time is drawn on its weekday", async () => {
  mount(plan({ limits: sundayOff }));

  const sunday = await screen.findByRole("group", {
    name: "Sonntag, 15. November",
  });
  expect(
    within(sunday).getByRole("note", { name: "Geschützte Zeit" }),
  ).toBeTruthy();
  expect(
    within(
      screen.getByRole("group", { name: "Samstag, 14. November" }),
    ).queryByRole("note"),
  ).toBeNull();
});

test("each display option hides what it names", async () => {
  mount(
    plan({
      limits: {
        ...plan().limits,
        protectedTime: [
          { id: "fri", weekday: 5, fromMinute: 18 * 60, toMinute: 20 * 60 },
        ],
      },
      fixedEvents: [
        {
          id: "f-1",
          title: "Vorlesung Analysis II",
          start: at(9, 10),
          end: at(9, 12),
          calendarId: null,
          seriesId: null,
          courseId: null,
        },
      ],
      proposal: {
        moves: [create],
        unplanned: [],
        shortfalls: [],
        overlaps: [],
      },
    }),
  );
  const user = userEvent.setup();
  await screen.findByRole("button", {
    name: "Klausur Statistics II, 09:00–11:00",
  });
  const toggle = async (option: string) => {
    await user.click(screen.getByRole("button", { name: "Anzeige" }));
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: option }),
    );
    await user.keyboard("{Escape}");
  };

  await toggle("Vorschläge");
  expect(screen.queryByRole("button", { name: /Vorschlag$/ })).toBeNull();

  await toggle("Geschützte Zeit");
  expect(screen.queryByRole("note", { name: "Geschützte Zeit" })).toBeNull();

  await toggle("Mein Kalender");
  expect(
    screen.queryByRole("button", { name: /^Vorlesung Analysis II/ }),
  ).toBeNull();

  expect(
    screen.getByRole("group", { name: "Sonntag, 15. November" }),
  ).toBeTruthy();
  await toggle("Wochenenden");
  expect(
    screen.queryByRole("group", { name: "Sonntag, 15. November" }),
  ).toBeNull();
  expect(
    screen.queryByRole("group", { name: "Samstag, 14. November" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Klausur Statistics II, 09:00–11:00" }),
  ).toBeTruthy();
});

test("the grid's hours follow the student's study window", async () => {
  mount(
    plan({
      studyBlocks: [],
      limits: {
        ...plan().limits,
        preferences: {
          ...plan().limits.preferences,
          studyFromMinute: 10 * 60,
          studyToMinute: 16 * 60,
        },
      },
    }),
  );

  expect(await screen.findByText("10:00")).toBeTruthy();
  expect(screen.getByText("16:00")).toBeTruthy();
  expect(screen.queryByText("08:00")).toBeNull();
  expect(screen.queryByText("18:00")).toBeNull();
});

test("when the Plan can't load, the student is told so", async () => {
  api.route("GET", "/api/me/plan", () => new Response(null, { status: 500 }));
  render(
    <TestProviders>
      <SidebarProvider>
        <PlanScreen apiOrigin={api.origin} today={today} />
      </SidebarProvider>
    </TestProviders>,
  );

  // The query retries once before giving up.
  const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
  expect(alert.textContent).toBe("Dein Plan konnte nicht geladen werden.");
});

test("a suggestion the Plan has outgrown is explained, not silently dropped", async () => {
  api.route("POST", "/api/me/plan/apply", () =>
    Response.json({ error: "stale" }, { status: 409 }),
  );
  mount(withSuggestion);
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Vorschläge anzeigen, 1 neu" }),
  );
  const sheet = await screen.findByRole("dialog", {
    name: "Änderungsvorschläge",
  });
  await user.click(within(sheet).getByRole("button", { name: "Annehmen" }));

  expect((await within(sheet).findByRole("alert")).textContent).toBe(
    "Dein Plan hat sich inzwischen geändert. Hier sind die neuen Vorschläge.",
  );
});

test("a Fixed Event opens what nunio knows about it", async () => {
  mount(
    plan({
      calendars: [{ id: "cal-1", name: "Uni-Stundenplan", events: 1 }],
      fixedEvents: [
        {
          id: "f-1",
          title: "Vorlesung Analysis II",
          start: at(9, 10),
          end: at(9, 12),
          calendarId: "cal-1",
          seriesId: null,
          courseId: null,
        },
      ],
    }),
  );
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", {
      name: "Vorlesung Analysis II, 10:00–12:00",
    }),
  );

  const details = await screen.findByRole("dialog");
  expect(
    within(details).getByText("Fixtermin aus „Uni-Stundenplan“"),
  ).toBeTruthy();
  expect(within(details).queryByRole("button", { name: "Löschen" })).toBeNull();
});

test("the Plan lists open Tasks, which the student completes, and adds one in a Course", async () => {
  const calls: [string, unknown][] = [];
  api.route("POST", "/api/me/tasks", async (request) => {
    calls.push(["add", await request.json()]);
    return Response.json({ id: "t-new" }, { status: 201 });
  });
  api.route("POST", "/api/me/tasks/t-1/done", async (request) => {
    calls.push(["done", await request.json()]);
    return Response.json({ status: "ok" });
  });
  const task = {
    obligationId: null,
    courseId: "c-stats",
    course: "Statistics II",
    estimate: { minutes: 60, estimatedBy: "student" as const, rationale: null },
    maxMinutesPerDay: null,
    fixedEventId: null,
    role: null,
    window: null,
  };
  mount(
    plan({
      tasks: [
        {
          ...task,
          id: "t-1",
          title: "Nachbereitung: Statistik",
          done: false,
          fixedEventId: "f-1",
          role: "follow_up",
          window: { start: at(9, 12), end: at(16, 10) },
        },
        { ...task, id: "t-2", title: "Schon erledigt", done: true },
      ],
    }),
  );
  const user = userEvent.setup();

  const list = await screen.findByRole("region", { name: "Aufgaben" });
  expect(within(list).getByText("Nachbereitung: Statistik")).toBeTruthy();
  expect(within(list).getByText(/bis .*16\.11\./)).toBeTruthy();
  expect(within(list).queryByText("Schon erledigt")).toBeNull();
  await user.click(
    within(list).getByRole("checkbox", {
      name: "Nachbereitung: Statistik erledigt",
    }),
  );
  await user.type(
    within(list).getByRole("textbox", { name: "Neue Aufgabe" }),
    "Skript lesen",
  );
  await user.click(within(list).getByRole("combobox", { name: "Kurs" }));
  await user.click(
    await screen.findByRole("option", { name: "Statistics II" }),
  );
  await user.click(within(list).getByRole("button", { name: "Hinzufügen" }));

  await waitFor(() =>
    expect(calls).toEqual([
      ["done", { done: true }],
      [
        "add",
        { title: "Skript lesen", obligationId: null, courseId: "c-stats" },
      ],
    ]),
  );
});

test("a Task that cannot be added tells the student in the Aufgaben section", async () => {
  api.route("POST", "/api/me/tasks", () => new Response(null, { status: 500 }));
  mount();
  const user = userEvent.setup();

  const list = await screen.findByRole("region", { name: "Aufgaben" });
  await user.type(
    within(list).getByRole("textbox", { name: "Neue Aufgabe" }),
    "Skript lesen",
  );
  await user.click(within(list).getByRole("button", { name: "Hinzufügen" }));

  expect((await within(list).findByRole("alert")).textContent).toBe(
    "Die Aufgabe konnte nicht gespeichert werden.",
  );
});

test("a Course Event shows its Course, and the student can take it out of it", async () => {
  let detached = false;
  api.route("POST", "/api/me/fixed-events/f-1/detach", () => {
    detached = true;
    return Response.json({ status: "ok" });
  });
  mount(
    plan({
      calendars: [{ id: "cal-1", name: "Uni-Stundenplan", events: 1 }],
      eventSeries: [
        {
          id: "s-1",
          calendarId: "cal-1",
          title: "Vorlesung Statistik",
          courseId: "c-stats",
          state: "confirmed",
          routine: null,
        },
      ],
      fixedEvents: [
        {
          id: "f-1",
          title: "Vorlesung Statistik",
          start: at(9, 10),
          end: at(9, 12),
          calendarId: "cal-1",
          seriesId: "s-1",
          courseId: "c-stats",
        },
      ],
    }),
  );
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", {
      name: "Vorlesung Statistik, 10:00–12:00",
    }),
  );
  const details = await screen.findByRole("dialog");
  expect(within(details).getByText("Termin in Statistics II")).toBeTruthy();
  await user.click(
    within(details).getByRole("button", {
      name: "Gehört nicht zu Statistics II",
    }),
  );

  await waitFor(() => expect(detached).toBe(true));
});
