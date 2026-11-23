import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PlanView } from "@/app/(app)/plan/plan-view";
import { ProjectsView } from "@/app/(app)/projects/projects-view";
import { ReviewList } from "@/app/(app)/review/review-list";
import { api } from "./api";

const exam = { id: "exam-1", title: "Klausur" };
const course = {
  id: "course-1",
  title: "Analysis I",
  code: null,
  status: "accepted",
  archived: false,
  obligations: [exam],
  facts: [],
};

const stubMatchMedia = () =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );

test("the Project select submits its chosen Obligation and resets to no Obligation", async () => {
  const created: unknown[] = [];
  api.route("GET", "/api/me/projects", () => Response.json([]));
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: [course] }),
  );
  api.route("POST", "/api/me/projects", async (request) => {
    created.push(await request.json());
    return Response.json({ id: "project-1" });
  });
  render(<ProjectsView apiOrigin={api.origin} />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "Analysis I" });
  const select = screen.getByRole("combobox", { name: "Toward" });
  expect(select.textContent).toContain("No Obligation");
  await user.type(screen.getByLabelText("Name"), "Prüfungsvorbereitung");
  await user.click(select);
  await user.click(
    await screen.findByRole("option", { name: "Klausur (Analysis I)" }),
  );
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() =>
    expect(created).toEqual([
      { name: "Prüfungsvorbereitung", courseIds: [], obligationId: "exam-1" },
    ]),
  );
  await waitFor(() => expect(select.textContent).toContain("No Obligation"));
});

test("the Review selects submit a Course and Kind, then restore their defaults", async () => {
  stubMatchMedia();
  const created: unknown[] = [];
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: [{ ...course, obligations: [] }] }),
  );
  const suggestions = vi.fn(() => Response.json([]));
  api.route("GET", "/api/me/courses/merge-suggestions", suggestions);
  api.route("GET", "/api/me/plan", () =>
    Response.json({ eventSeries: [], fixedEvents: [], calendars: [] }),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: [], courses: [] }),
  );
  api.route("POST", "/api/me/obligations", async (request) => {
    created.push(await request.json());
    return Response.json({ id: "obligation-1" });
  });
  render(
    <SidebarProvider>
      <ReviewList apiOrigin={api.origin} />
    </SidebarProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Frist hinzufügen" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Frist hinzufügen",
  });
  const select = within(dialog).getByRole("combobox", { name: "Kurs" });
  expect(select.textContent).toContain("Analysis I");
  await user.click(select);
  await user.click(await screen.findByRole("option", { name: "Neuer Kurs…" }));
  await user.type(within(dialog).getByLabelText("Kurstitel"), "Statistik");
  await user.type(
    within(dialog).getByLabelText("Titel", { exact: true }),
    "Abschlussprüfung",
  );
  const kind = within(dialog).getByRole("combobox", { name: "Art" });
  expect(kind.textContent).toContain("Abgabe");
  await user.click(kind);
  await user.click(await screen.findByRole("option", { name: "Klausur" }));
  await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
  await waitFor(() =>
    expect(created).toEqual([
      {
        course: { title: "Statistik", code: null },
        kind: "exam",
        title: "Abschlussprüfung",
        due: { date: null, time: null, timeZone: null },
        destination: null,
      },
    ]),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Frist hinzufügen" }),
    ).toBeNull(),
  );
  await waitFor(() => expect(suggestions).toHaveBeenCalledTimes(2));

  // Reopening restores the Course and Kind defaults.
  await user.click(screen.getByRole("button", { name: "Frist hinzufügen" }));
  const reopened = await screen.findByRole("dialog", {
    name: "Frist hinzufügen",
  });
  expect(
    within(reopened).getByRole("combobox", { name: "Kurs" }).textContent,
  ).toContain("Analysis I");
  expect(
    within(reopened).getByRole("combobox", { name: "Art" }).textContent,
  ).toContain("Abgabe");
  expect(within(reopened).queryByLabelText("Kurstitel")).toBeNull();
});

test("the required merge select submits the chosen target Course", async () => {
  stubMatchMedia();
  const merged: unknown[] = [];
  api.route("GET", "/api/me/review", () =>
    Response.json({
      courses: [
        { ...course, obligations: [] },
        { ...course, id: "course-2", title: "Statistik", obligations: [] },
      ],
    }),
  );
  const suggestions = vi.fn(() => Response.json([]));
  api.route("GET", "/api/me/courses/merge-suggestions", suggestions);
  api.route("GET", "/api/me/plan", () =>
    Response.json({ eventSeries: [], fixedEvents: [], calendars: [] }),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: [], courses: [] }),
  );
  api.route("POST", "/api/me/courses/course-1/merge", async (request) => {
    merged.push(await request.json());
    return Response.json({ status: "ok" });
  });
  render(
    <SidebarProvider>
      <ReviewList apiOrigin={api.origin} />
    </SidebarProvider>,
  );
  const user = userEvent.setup();
  const article = await screen.findByRole("article", { name: "Analysis I" });
  await user.click(
    within(article).getByRole("button", {
      name: "Kursaktionen für Analysis I",
    }),
  );
  await user.click(
    await screen.findByRole("menuitem", { name: "Gleicher Kurs wie …" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Kurs zusammenführen",
  });
  const select = within(dialog).getByRole("combobox", {
    name: "Gleicher Kurs wie",
  });
  expect(select.textContent).toContain("Kurs wählen");
  await user.click(
    within(dialog).getByRole("button", { name: "Zusammenführen" }),
  );
  expect(merged).toEqual([]);
  await user.click(select);
  await user.click(await screen.findByRole("option", { name: "Statistik" }));
  await user.click(
    within(dialog).getByRole("button", { name: "Zusammenführen" }),
  );
  await waitFor(() => expect(merged).toEqual([{ into: "course-2" }]));
  await waitFor(() => expect(suggestions).toHaveBeenCalledTimes(2));
});

test("Plan selects preserve Task associations and numeric Protected Time weekdays", async () => {
  const tasks: unknown[] = [];
  const protectedTime: unknown[] = [];
  api.route("GET", "/api/me/projects", () => Response.json([]));
  api.route("GET", "/api/me/plan", () =>
    Response.json({
      obligations: [{ ...exam, courseId: course.id, course: course.title }],
      tasks: [],
      studyBlocks: [],
      calendars: [],
      fixedEvents: [],
      priorities: [],
      proposal: { moves: [], shortfalls: [], unplanned: [], overlaps: [] },
      limits: {
        preferences: {
          studyFromMinute: 480,
          studyToMinute: 1200,
          maxMinutesPerDay: 240,
        },
        courses: [],
        protectedTime: [],
      },
    }),
  );
  api.route("POST", "/api/me/tasks", async (request) => {
    tasks.push(await request.json());
    return Response.json({ id: "task-1" });
  });
  api.route("POST", "/api/me/protected-time", async (request) => {
    protectedTime.push(await request.json());
    return Response.json({ id: "protected-1" });
  });
  render(<PlanView apiOrigin={api.origin} />);
  const user = userEvent.setup();
  const select = await screen.findByRole("combobox", { name: "For" });
  expect(select.textContent).toContain("No Obligation");
  await user.type(screen.getByLabelText("Task"), "Kapitel wiederholen");
  await user.click(select);
  await user.click(await screen.findByRole("option", { name: "Klausur" }));
  await user.click(
    within(screen.getByRole("region", { name: "Tasks" })).getByRole("button", {
      name: "Add",
    }),
  );
  await waitFor(() =>
    expect(tasks).toEqual([
      { title: "Kapitel wiederholen", obligationId: "exam-1" },
    ]),
  );
  await waitFor(() => expect(select.textContent).toContain("No Obligation"));

  const weekday = screen.getByRole("combobox", { name: "Every" });
  expect(weekday.textContent).toContain("Monday");
  await user.click(weekday);
  await user.click(await screen.findByRole("option", { name: "Wednesday" }));
  const form = weekday.closest("form")!;
  await user.type(within(form).getByLabelText("from"), "12:00");
  await user.type(within(form).getByLabelText("until"), "13:00");
  await user.click(within(form).getByRole("button", { name: "Protect" }));
  await waitFor(() =>
    expect(protectedTime).toEqual([
      { weekday: 3, fromMinute: 720, toMinute: 780 },
    ]),
  );
  await waitFor(() => expect(weekday.textContent).toContain("Monday"));
});
