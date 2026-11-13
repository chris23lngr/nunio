import {
  render as renderComponent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppLayout from "@/app/(app)/layout";
import { api } from "./api";
import { TestProviders } from "./providers";

function render(element: ReactElement) {
  return renderComponent(<TestProviders>{element}</TestProviders>);
}

const { route } = vi.hoisted(() => ({ route: { pathname: "/" } }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

/** A Course as the course list returns it. */
function course(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    code: null,
    title: "Analysis I",
    status: "accepted",
    semester: "2026-ws",
    color: "blue",
    entered: true,
    archived: false,
    next: null,
    lastActivityAt: null,
    ...overrides,
  };
}

function serveCourses(courses: unknown[]) {
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: ["2026-ws"], courses }),
  );
}

const recentCourses = () =>
  within(screen.getByRole("group", { name: "Recent Courses" }));

beforeEach(() => {
  route.pathname = "/";
  vi.stubEnv("API_ORIGIN", api.origin);
  api.route("GET", "/api/auth/get-session", () => Response.json(null));
  serveCourses([]);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("each navigation link has its own decorative icon", () => {
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  expect(screen.queryByRole("link", { name: "Account" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "Einstellungen" }).getAttribute("href"),
  ).toBe("/settings/security");

  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(10);
  const glyphs = links.map((link) => {
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    return icon!.innerHTML;
  });
  expect(new Set(glyphs).size).toBe(10);
});

test.each([
  ["/", "Home"],
  ["/inbox", "Inbox"],
  ["/review", "Review"],
  ["/chat", "Chat"],
  ["/plan", "Plan"],
  ["/study", "Study"],
  ["/study/artifacts/a-1", "Study"],
  ["/courses", "Kurse"],
  ["/projects", "Projects"],
  ["/responsibilities", "Responsibilities"],
  ["/projects/project-1", "Projects"],
  ["/responsibilities/r-1", "Responsibilities"],
])("%s selects only %s in app navigation", (pathname, title) => {
  route.pathname = pathname;
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const navigation = within(
    screen.getByRole("navigation", { name: "App navigation" }),
  );
  expect(navigation.getByRole("link", { current: "page" }).textContent).toBe(
    title,
  );
  for (const link of navigation.getAllByRole("link")) {
    expect(link.hasAttribute("data-active")).toBe(link.textContent === title);
  }
});

test("a shared URL prefix does not select another section", () => {
  route.pathname = "/projects-archive";
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  expect(screen.queryByRole("link", { current: "page" })).toBeNull();
});

test("the layout trigger and keyboard shortcut toggle the sidebar together", async () => {
  const user = userEvent.setup();
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const navigation = screen.getByRole("navigation", { name: "App navigation" });
  const sidebar = navigation.closest('[data-slot="sidebar"]')!;
  expect(sidebar.getAttribute("data-state")).toBe("expanded");

  expect(screen.queryByRole("button", { name: "Sidebar öffnen" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Sidebar schließen" }));
  expect(sidebar.getAttribute("data-state")).toBe("collapsed");

  await user.click(screen.getByRole("button", { name: "Sidebar öffnen" }));
  expect(sidebar.getAttribute("data-state")).toBe("expanded");
  expect(screen.queryByRole("button", { name: "Sidebar öffnen" })).toBeNull();

  await user.keyboard("{Control>}b{/Control}");
  expect(sidebar.getAttribute("data-state")).toBe("collapsed");
  await user.keyboard("{Control>}b{/Control}");
  expect(sidebar.getAttribute("data-state")).toBe("expanded");
  expect(screen.getByRole("main").textContent).toBe("Page content");
});

test.each(["/chat", "/plan"])(
  "on %s the page's own header opens the sidebar, so the layout adds no second button",
  async (pathname) => {
    route.pathname = pathname;
    const user = userEvent.setup();
    render(
      <AppLayout>
        <main>Page content</main>
      </AppLayout>,
    );

    await user.click(screen.getByRole("button", { name: "Sidebar schließen" }));

    expect(screen.queryByRole("button", { name: "Sidebar öffnen" })).toBeNull();
  },
);

test("lists the Courses the student last worked on, latest first, each linking to its page", async () => {
  const statistics = course({
    title: "Statistik II",
    color: "fuchsia",
    lastActivityAt: "2026-11-09T09:00:00.000Z",
  });
  const analysis = course({
    title: "Analysis I",
    lastActivityAt: "2026-11-10T08:00:00.000Z",
  });
  serveCourses([statistics, analysis]);
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const links = await recentCourses().findAllByRole("link");
  expect(
    links.map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Analysis I", `/courses/${analysis.id}`],
    ["Statistik II", `/courses/${statistics.id}`],
  ]);
});

test("shows at most three Recent Courses, leaving out Archived, proposed and untouched ones", async () => {
  serveCourses([
    course({ title: "Analysis I", lastActivityAt: "2026-11-10T08:00:00.000Z" }),
    course({
      title: "Statistik II",
      lastActivityAt: "2026-11-09T08:00:00.000Z",
    }),
    course({
      title: "Mikroökonomik",
      lastActivityAt: "2026-11-08T08:00:00.000Z",
    }),
    course({
      title: "Lineare Algebra",
      lastActivityAt: "2026-11-07T08:00:00.000Z",
    }),
    course({
      title: "Programmieren",
      archived: true,
      lastActivityAt: "2026-11-10T09:00:00.000Z",
    }),
    course({
      title: "Physik",
      status: "proposed",
      entered: false,
      lastActivityAt: "2026-11-10T09:00:00.000Z",
    }),
    course({ title: "Chemie" }),
  ]);
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const links = await recentCourses().findAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "Analysis I",
    "Statistik II",
    "Mikroökonomik",
  ]);
});

test("says where Recent Courses will appear while the student has worked on none", async () => {
  serveCourses([course({ title: "Analysis I" })]);
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  expect(
    await recentCourses().findByText("Recent courses appear here"),
  ).toBeTruthy();
  expect(recentCourses().queryAllByRole("link")).toEqual([]);
});

test("says when Recent Courses cannot be loaded and lets the student try again", async () => {
  let fail = true;
  api.route("GET", "/api/me/courses", () =>
    fail
      ? Response.json({ error: "unavailable" }, { status: 500 })
      : Response.json({
          current: "2026-ws",
          choices: ["2026-ws"],
          courses: [
            course({
              title: "Analysis I",
              lastActivityAt: "2026-11-10T08:00:00.000Z",
            }),
          ],
        }),
  );
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );
  const user = userEvent.setup();

  expect(
    await recentCourses().findByText(
      "Couldn’t load your courses",
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  fail = false;
  await user.click(recentCourses().getByRole("button", { name: "Try again" }));

  const links = await recentCourses().findAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual(["Analysis I"]);
});

test("marks Recent Courses as loading until they arrive, without claiming there are none", async () => {
  let respond = () => {};
  const answered = new Promise<void>((resolve) => {
    respond = resolve;
  });
  api.route("GET", "/api/me/courses", async () => {
    await answered;
    return Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [
        course({
          title: "Analysis I",
          lastActivityAt: "2026-11-10T08:00:00.000Z",
        }),
      ],
    });
  });
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const group = screen.getByRole("group", { name: "Recent Courses" });
  expect(group.getAttribute("aria-busy")).toBe("true");
  expect(recentCourses().queryByText("Recent courses appear here")).toBeNull();

  respond();
  expect(
    (await recentCourses().findAllByRole("link")).map((l) => l.textContent),
  ).toEqual(["Analysis I"]);
  expect(group.getAttribute("aria-busy")).toBe("false");
});

test.each(["", "/sources"])(
  "on a Course's page%s, selects that Course among Recent Courses",
  async (subpage) => {
    const statistics = course({
      title: "Statistik II",
      lastActivityAt: "2026-11-09T08:00:00.000Z",
    });
    serveCourses([
      course({
        title: "Analysis I",
        lastActivityAt: "2026-11-10T08:00:00.000Z",
      }),
      statistics,
    ]);
    route.pathname = `/courses/${statistics.id}${subpage}`;
    render(
      <AppLayout>
        <main>Page content</main>
      </AppLayout>,
    );

    await recentCourses().findAllByRole("link");
    expect(
      recentCourses().getByRole("link", { current: "page" }).textContent,
    ).toBe("Statistik II");
    expect(
      recentCourses()
        .getAllByRole("link")
        .filter((link) => link.hasAttribute("data-active"))
        .map((link) => link.textContent),
    ).toEqual(["Statistik II"]);
  },
);

test("on a phone, tapping a Recent Course closes the sidebar", async () => {
  vi.stubGlobal("innerWidth", 500);
  serveCourses([
    course({ title: "Analysis I", lastActivityAt: "2026-11-10T08:00:00.000Z" }),
  ]);
  const user = userEvent.setup();
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  await user.keyboard("{Control>}b{/Control}");
  const link = await recentCourses().findByRole("link", { name: "Analysis I" });
  await user.click(link);

  await waitFor(() =>
    expect(screen.queryByRole("group", { name: "Recent Courses" })).toBeNull(),
  );
});
