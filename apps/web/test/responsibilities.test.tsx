import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ResponsibilitiesScreen } from "@/features/responsibilities/responsibilities-screen";
import { ResponsibilityScreen } from "@/features/responsibilities/responsibility-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const courses = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    code: "MA-101",
    title: "Analysis I",
    status: "accepted",
    obligations: [],
    facts: [],
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    code: null,
    title: "Physik I",
    status: "proposed",
    obligations: [],
    facts: [],
  },
];

test("the student delegates 'keep this course organized' for one of their accepted Courses", async () => {
  let delegated: object[] = [];
  const created: unknown[] = [];
  api.route("GET", "/api/me/responsibilities", () => Response.json(delegated));
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("POST", "/api/me/responsibilities", async (request) => {
    created.push(await request.json());
    delegated = [
      {
        id: "r-1",
        preset: "keep_course_organized",
        course: { id: courses[0]!.id, title: "Analysis I" },
        state: "active",
        pausedBy: null,
      },
    ];
    return Response.json({ id: "r-1" }, { status: 201 });
  });
  render(
    <TestProviders>
      <ResponsibilitiesScreen apiOrigin={api.origin} />
    </TestProviders>,
  );

  const course = await screen.findByRole("combobox", { name: "Course" });
  await userEvent.click(course);
  await screen.findByRole("option", { name: "Analysis I" });
  expect(screen.queryByRole("option", { name: "Physik I" })).toBeNull();
  await userEvent.click(screen.getByRole("option", { name: "Analysis I" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Keep this course organized" }),
  );

  const row = await screen.findByRole("link", {
    name: /Keep Analysis I organized/,
  });
  expect(row.getAttribute("href")).toBe("/responsibilities/r-1");
  expect(within(row.closest("li")!).getByText(/active/i)).toBeTruthy();
  await waitFor(() =>
    expect(created).toEqual([
      { preset: "keep_course_organized", courseId: courses[0]!.id },
    ]),
  );
});

const shown = (state: "active" | "paused") => ({
  id: "r-1",
  preset: "keep_course_organized",
  course: { id: courses[0]!.id, title: "Analysis I" },
  state,
  pausedBy: state === "paused" ? "student" : null,
  grants: ["studyBlock.create", "studyBlock.move"],
  budget: { limitMicroUsd: 1_000_000, usedMicroUsd: 250_000, heldMicroUsd: 0 },
  recentActions: [
    {
      id: "a-1",
      status: "done",
      refusal: null,
      at: "2026-11-17T05:00:00.000Z",
      action: {
        kind: "studyBlock.create",
        work: { title: "Problem sheet 1", course: "Analysis I" },
        from: null,
        to: {
          start: "2026-11-17T09:00:00.000Z",
          end: "2026-11-17T10:00:00.000Z",
        },
      },
    },
  ],
  next:
    state === "active"
      ? {
          runAt: "2026-11-18T05:00:00.000Z",
          action: {
            kind: "studyBlock.create",
            work: { title: "Problem sheet 2", course: "Analysis I" },
            from: null,
            to: {
              start: "2026-11-18T09:00:00.000Z",
              end: "2026-11-18T10:00:00.000Z",
            },
          },
        }
      : { runAt: null, action: null },
});

test("a Responsibility's screen shows its scope, Grants, recent and next Actions and Budget, and pauses it", async () => {
  let state: "active" | "paused" = "active";
  const controls: string[] = [];
  api.route("GET", "/api/me/responsibilities/r-1", () =>
    Response.json(shown(state)),
  );
  api.route("POST", "/api/me/responsibilities/r-1/pause", () => {
    controls.push("pause");
    state = "paused";
    return Response.json({ status: "ok" });
  });
  render(
    <TestProviders>
      <ResponsibilityScreen apiOrigin={api.origin} id="r-1" />
    </TestProviders>,
  );

  expect(
    await screen.findByRole("heading", { name: "Keep Analysis I organized" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/add Study Blocks and move the ones nunio placed/i),
  ).toBeTruthy();
  expect(
    screen.getByRole("list", { name: "Recent Actions" }).textContent,
  ).toMatch(/Added a block for Problem sheet 1/);
  expect(
    screen.getByText(/Next: add a block for Problem sheet 2/),
  ).toBeTruthy();
  expect(screen.getByText("$0.25 of $1.00 used")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Pause" }));

  expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
  expect(screen.getByText(/Paused by you/)).toBeTruthy();
  expect(controls).toEqual(["pause"]);
});

test("pausing refreshes the list even while its cached state is fresh", async () => {
  let state: "active" | "paused" = "active";
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("GET", "/api/me/responsibilities", () =>
    Response.json([shown(state)]),
  );
  api.route("GET", "/api/me/responsibilities/r-1", () =>
    Response.json(shown(state)),
  );
  api.route("POST", "/api/me/responsibilities/r-1/pause", () => {
    state = "paused";
    return Response.json({ status: "ok" });
  });
  render(
    <TestProviders>
      <ResponsibilitiesScreen apiOrigin={api.origin} />
      <ResponsibilityScreen apiOrigin={api.origin} id="r-1" />
    </TestProviders>,
  );
  const row = (
    await screen.findByRole("link", { name: "Keep Analysis I organized" })
  ).closest("li")!;
  expect(row.textContent).toContain("active");
  await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await screen.findByRole("button", { name: "Resume" });
  await waitFor(() => expect(row.textContent).toContain("paused"));
});

test("the student delegates 'prepare me for this exam' for one of their exams", async () => {
  const withExams = [
    {
      ...courses[0]!,
      obligations: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          kind: "exam",
          title: "Klausur",
          state: "confirmed",
        },
        {
          id: "e0000000-0000-4000-8000-000000000002",
          kind: "assignment",
          title: "Blatt 3",
          state: "confirmed",
        },
        {
          id: "e0000000-0000-4000-8000-000000000003",
          kind: "exam",
          title: "Probeklausur",
          state: "rejected",
        },
      ],
    },
  ];
  const created: unknown[] = [];
  api.route("GET", "/api/me/responsibilities", () => Response.json([]));
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: withExams }),
  );
  api.route("POST", "/api/me/responsibilities", async (request) => {
    created.push(await request.json());
    return Response.json({ id: "r-2" }, { status: 201 });
  });
  render(
    <TestProviders>
      <ResponsibilitiesScreen apiOrigin={api.origin} />
    </TestProviders>,
  );

  const exam = await screen.findByRole("combobox", { name: "Exam" });
  await userEvent.click(exam);
  await screen.findByRole("option", { name: "Klausur (Analysis I)" });
  expect(
    screen.queryByRole("option", { name: /Blatt 3|Probeklausur/ }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("option", { name: "Klausur (Analysis I)" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Prepare me for this exam" }),
  );

  await waitFor(() =>
    expect(created).toEqual([
      {
        preset: "prepare_for_exam",
        obligationId: "e0000000-0000-4000-8000-000000000001",
      },
    ]),
  );
});

test("an exam's Responsibility is named for the exam in the list and on its screen", async () => {
  const exam = { id: "e0000000-0000-4000-8000-000000000001", title: "Klausur" };
  api.route("GET", "/api/me/responsibilities", () =>
    Response.json([
      {
        id: "r-2",
        preset: "prepare_for_exam",
        course: { id: courses[0]!.id, title: "Analysis I" },
        exam,
        state: "active",
        pausedBy: null,
      },
    ]),
  );
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("GET", "/api/me/responsibilities/r-2", () =>
    Response.json({
      ...shown("active"),
      id: "r-2",
      preset: "prepare_for_exam",
      exam,
    }),
  );
  render(
    <TestProviders>
      <ResponsibilitiesScreen apiOrigin={api.origin} />
      <ResponsibilityScreen apiOrigin={api.origin} id="r-2" />
    </TestProviders>,
  );

  expect(
    (
      await screen.findByRole("link", { name: "Prepare for Klausur" })
    ).getAttribute("href"),
  ).toBe("/responsibilities/r-2");
  expect(
    await screen.findByRole("heading", {
      name: "Prepare for Klausur (Analysis I)",
    }),
  ).toBeTruthy();
});
