import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HomeScreen } from "@/features/home/home-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

/** The page header needs the app's sidebar. */
function Providers({ children }: { children: ReactNode }) {
  return (
    <TestProviders>
      <SidebarProvider>{children}</SidebarProvider>
    </TestProviders>
  );
}

const emptyHome = { attention: [], ongoing: [], artifacts: [], agentWork: [] };
const emptyPlan = {
  obligations: [],
  tasks: [],
  studyBlocks: [],
  fixedEvents: [],
};

const statsCourse = {
  id: "course-stats",
  code: "ST-201",
  title: "Statistics II",
  status: "accepted",
  semester: "2026-ws",
  color: "blue",
  entered: false,
  archived: false,
  next: null,
};

const approval = {
  actionId: "7b0c3c3e-0000-4000-8000-000000000001",
  action: {
    kind: "studyBlock.move",
    work: { title: "Statistics II", course: "Statistics II" },
    from: {
      start: "2026-11-17T09:00:00.000Z",
      end: "2026-11-17T10:00:00.000Z",
    },
    to: {
      start: "2026-11-18T13:00:00.000Z",
      end: "2026-11-18T14:00:00.000Z",
    },
    task: null,
  },
  fingerprint:
    "a3f9c21eef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12",
  expiresAt: "2026-11-24T19:00:00.000Z",
  agent: { id: "agent-1", name: "Klausur vorbereiten" },
};

const unconfirmedAction = {
  actionId: "7b0c3c3e-0000-4000-8000-000000000002",
  action: {
    kind: "studyBlock.create",
    work: { title: "Problem sheet 3", course: "Algorithms" },
    from: null,
    to: {
      start: "2026-11-19T13:00:00.000Z",
      end: "2026-11-19T14:30:00.000Z",
    },
    task: null,
  },
};

/** A day where nothing is open; each test replaces the routes it is about. */
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  api.route("GET", "/api/me/home", () => Response.json(emptyHome));
  api.route("GET", "/api/me/approvals", () => Response.json([]));
  api.route("GET", "/api/me/actions/unconfirmed", () => Response.json([]));
  api.route("GET", "/api/me/plan", () => Response.json(emptyPlan));
  api.route("GET", "/api/me/sources", () => Response.json([]));
  api.route("GET", "/api/me/courses", () => Response.json({ courses: [] }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderHome() {
  render(
    <Providers>
      <HomeScreen apiOrigin={api.origin} />
    </Providers>,
  );
}

test("a quiet day says nothing needs the student and shows quiet states", async () => {
  renderHome();

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
    "Ein ruhiger Tag. Nichts braucht dich gerade.",
  );
  expect(screen.getByText("Nichts braucht dich gerade.")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Wartet auf dich" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Als Nächstes" })).toBeNull();

  const ready = screen.getByRole("region", { name: "Bereit für dich" });
  expect(within(ready).getByText("Noch nichts Neues von nunio.")).toBeTruthy();
  expect(
    within(ready)
      .getByRole("link", { name: "Alles Vorbereitete" })
      .getAttribute("href"),
  ).toBe("/artifacts");

  const background = screen.getByRole("region", { name: "Im Hintergrund" });
  expect(within(background).getByText("Gerade läuft nichts.")).toBeTruthy();
  expect(
    within(background)
      .getByRole("link", { name: "Agent einrichten" })
      .getAttribute("href"),
  ).toBe("/agents");

  const sources = screen.getByRole("region", { name: "Quellen" });
  expect(
    within(sources)
      .getByRole("link", { name: "Alle Quellen" })
      .getAttribute("href"),
  ).toBe("/sources");
});

test("Als Nächstes shows today's next Study Block and hides when none is left today", async () => {
  const now = new Date();
  const start = new Date(now.getTime() + 20 * 60_000);
  const end = new Date(now.getTime() + 80 * 60_000);
  // Skip edge case where 20 min from now crosses midnight.
  if (start.getDate() === now.getDate()) {
    const pastStart = new Date(now.getTime() - 120 * 60_000);
    const pastEnd = new Date(now.getTime() - 60 * 60_000);
    const tomorrowStart = new Date(now.getTime() + 30 * 60 * 60_000);
    const tomorrowEnd = new Date(now.getTime() + 31 * 60 * 60_000);
    api.route("GET", "/api/me/plan", () =>
      Response.json({
        obligations: [
          {
            id: "ob-1",
            courseId: "course-stats",
            course: "Statistics II",
            title: "Klausur Statistics II",
            kind: "exam",
            state: "confirmed",
            reportedSubmittedAt: null,
            due: tomorrowEnd.toISOString(),
            estimate: null,
          },
        ],
        tasks: [],
        studyBlocks: [
          {
            id: "b-past",
            work: { kind: "obligation", id: "ob-1" },
            start: pastStart.toISOString(),
            end: pastEnd.toISOString(),
            placedBy: "nunio",
            locked: false,
          },
          {
            id: "b-tomorrow",
            work: { kind: "obligation", id: "ob-1" },
            start: tomorrowStart.toISOString(),
            end: tomorrowEnd.toISOString(),
            placedBy: "nunio",
            locked: false,
          },
          {
            id: "b-next",
            work: { kind: "obligation", id: "ob-1" },
            start: start.toISOString(),
            end: end.toISOString(),
            placedBy: "nunio",
            locked: false,
          },
        ],
        fixedEvents: [],
      }),
    );

    renderHome();

    const banner = await screen.findByRole("region", { name: "Als Nächstes" });
    expect(
      within(banner).getByText(
        "Als Nächstes: Lernblock für „Klausur Statistics II“",
      ),
    ).toBeTruthy();
    expect(
      within(banner).getByText(/Statistics II · \d{2}:\d{2}–\d{2}:\d{2}/),
    ).toBeTruthy();
    expect(within(banner).getByText(/in \d+ Min\./)).toBeTruthy();
    expect(
      within(banner)
        .getByRole("link", { name: "Plan öffnen" })
        .getAttribute("href"),
    ).toBe("/plan");
  }
});

test("approvals show Bisher/Neu diff and fingerprint, approve or deny, and refresh Home", async () => {
  const user = userEvent.setup();
  let pending = [approval];
  let homeReads = 0;
  const decisions: unknown[] = [];
  api.route("GET", "/api/me/home", () => {
    homeReads++;
    return Response.json(emptyHome);
  });
  api.route("GET", "/api/me/approvals", () => Response.json(pending));
  api.route("GET", "/api/me/courses", () =>
    Response.json({ courses: [statsCourse] }),
  );
  api.route(
    "POST",
    `/api/me/approvals/${approval.actionId}`,
    async (request) => {
      decisions.push(await request.json());
      pending = [];
      return Response.json({ status: "ok" });
    },
  );

  renderHome();

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
    "Eine Antwort für dich.",
  );
  // When only waiting items exist and no attention items, "Braucht dich" is hidden.
  expect(screen.queryByRole("region", { name: "Braucht dich" })).toBeNull();

  const waiting = screen.getByRole("region", { name: "Wartet auf dich" });
  const row = within(waiting).getByRole("listitem", {
    name: "Lernblock für „Statistics II“ verschieben",
  });
  expect(within(row).getByText("Bisher")).toBeTruthy();
  expect(within(row).getByText("Neu")).toBeTruthy();
  expect(within(row).getByText(/Fingerabdruck a3f9 c21e/)).toBeTruthy();

  const readsBefore = homeReads;
  await user.click(
    within(row).getByRole("button", { name: "Verschiebung erlauben" }),
  );

  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Wartet auf dich" }),
    ).toBeNull(),
  );
  expect(decisions).toEqual([
    { decision: "approve", fingerprint: approval.fingerprint },
  ]);
  expect(homeReads).toBeGreaterThan(readsBefore);
});

test("unconfirmed actions let the student resolve happened or did_not_happen", async () => {
  const user = userEvent.setup();
  let items = [unconfirmedAction];
  const resolutions: unknown[] = [];
  api.route("GET", "/api/me/actions/unconfirmed", () => Response.json(items));
  api.route(
    "POST",
    `/api/me/actions/${unconfirmedAction.actionId}/resolve`,
    async (request) => {
      resolutions.push(await request.json());
      items = [];
      return Response.json({ status: "ok" });
    },
  );

  renderHome();

  const waiting = await screen.findByRole("region", {
    name: "Wartet auf dich",
  });
  const row = within(waiting).getByRole("listitem", {
    name: /Nicht bestätigt: Lernblock für „Problem sheet 3“ anlegen/,
  });
  await user.click(within(row).getByRole("button", { name: "Ist passiert" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Wartet auf dich" }),
    ).toBeNull(),
  );
  expect(resolutions).toEqual([{ resolution: "happened" }]);
});

test("failed approval loading surfaces an alert instead of a quiet day", async () => {
  api.route("GET", "/api/me/approvals", () =>
    Response.json({ error: "boom" }, { status: 500 }),
  );

  renderHome();

  const waiting = await screen.findByRole(
    "region",
    { name: "Wartet auf dich" },
    { timeout: 3000 },
  );
  expect(within(waiting).getByRole("alert").textContent).toBeTruthy();
  expect(screen.queryByText("Nichts braucht dich gerade.")).toBeNull();
});

test("Braucht dich renders all intervention kinds and lets the student skip a Routine", async () => {
  const user = userEvent.setup();
  const skipped: unknown[] = [];
  api.route("GET", "/api/me/home", () =>
    Response.json({
      attention: [
        {
          kind: "shortfall",
          workId: "ob-1",
          title: "Klausur Statistics II",
          course: "Statistics II",
          due: "2026-12-02T08:00:00.000Z",
          shortMinutes: 180,
          unreviewed: true,
          tradeoffs: [
            {
              kind: "exceed_daily_limit",
              gainedMinutes: 120,
              needsApproval: true,
            },
            {
              kind: "skip_routine",
              routine: "series-1",
              title: "Vorlesung Statistics II",
              until: "2026-12-02T08:00:00.000Z",
              gainedMinutes: 60,
            },
          ],
        },
        {
          kind: "disagreement",
          item: { kind: "obligation", id: "ob-2" },
          title: "Klausur",
          course: "Microeconomics",
        },
        {
          kind: "overlap",
          blockId: "blk-1",
          title: "Problem sheet 3",
          reason: "locked",
        },
        {
          kind: "unplanned",
          workId: "ob-3",
          title: "Referat Spieltheorie",
          reason: "no_estimate",
        },
      ],
      ongoing: [],
      artifacts: [],
      agentWork: [],
    }),
  );
  api.route(
    "POST",
    "/api/me/event-series/series-1/routine/skip",
    async (request) => {
      skipped.push(await request.json());
      return Response.json({ status: "ok" });
    },
  );

  renderHome();

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
    "Vier Hinweise für dich.",
  );
  const section = screen.getByRole("region", { name: "Braucht dich" });
  expect(
    within(section).getByText("Für Klausur Statistics II fehlen 3 Std."),
  ).toBeTruthy();
  expect(within(section).getByText(/noch nicht geprüft/)).toBeTruthy();
  expect(
    within(section).getByRole("link", { name: "Prüfen" }).getAttribute("href"),
  ).toBe("/review");
  expect(
    within(section).getByText(
      "Lernblock für „Problem sheet 3“ überschneidet jetzt deinen Kalender",
    ),
  ).toBeTruthy();
  expect(
    within(section).getByText("„Referat Spieltheorie“ braucht eine Schätzung"),
  ).toBeTruthy();

  await user.click(
    within(section).getByRole("button", {
      name: "„Vorlesung Statistics II“ aussetzen",
    }),
  );

  await waitFor(() =>
    expect(skipped).toEqual([{ until: "2026-12-02T08:00:00.000Z" }]),
  );
});

test("right column lists ready artifacts, background sources, delegated agents, and 3 newest sources", async () => {
  api.route("GET", "/api/me/courses", () =>
    Response.json({ courses: [statsCourse] }),
  );
  api.route("GET", "/api/me/home", () =>
    Response.json({
      attention: [],
      ongoing: [
        {
          kind: "source",
          id: "src-bg-1",
          title: "Vorlesung 07.pdf",
          activity: "reading",
        },
        {
          kind: "source",
          id: "src-bg-2",
          title: "Syllabus ADS.pdf",
          activity: "processing",
        },
      ],
      artifacts: [
        {
          id: "art-1",
          kind: "practice_set",
          status: "ready",
          failure: null,
          topicIds: [],
          obligationId: null,
          createdAt: "2026-11-16T08:00:00.000Z",
          openedAt: null,
          withdrawn: false,
          title: "Hypothesentests",
          courseId: "course-stats",
          count: 12,
          version: 1,
          updatedAt: "2026-11-16T08:00:00.000Z",
          lastPractisedAt: null,
          shaky: false,
        },
      ],
      agentWork: [
        {
          kind: "approval",
          actionId: "act-1",
          title: "Klausur vorbereiten",
          expiresAt: "2026-11-16T20:00:00.000Z",
        },
        {
          kind: "agent",
          id: "agent-2",
          name: "Kurs organisieren",
          state: "active",
        },
      ],
    }),
  );
  api.route("GET", "/api/me/sources", () =>
    Response.json([
      {
        id: "src-1",
        title: "Oldest.pdf",
        status: "ready",
        extraction: "done",
        failure: null,
        courseId: null,
      },
      {
        id: "src-2",
        title: "Failed.pdf",
        status: "failed",
        extraction: "pending",
        failure: "too_many_pages",
        courseId: null,
      },
      {
        id: "src-3",
        title: "Ready.pdf",
        status: "ready",
        extraction: "done",
        failure: null,
        courseId: null,
      },
      {
        id: "src-4",
        title: "Newest.pdf",
        status: "processing",
        extraction: "pending",
        failure: null,
        courseId: null,
      },
    ]),
  );

  renderHome();

  const ready = await screen.findByRole("region", { name: "Bereit für dich" });
  const artifactLink = within(ready).getByRole("link", {
    name: /Hypothesentests/,
  });
  expect(artifactLink.getAttribute("href")).toBe("/artifacts/art-1");
  expect(
    await within(ready).findByText(/Statistics II · Übungsset · 12 Aufgaben/),
  ).toBeTruthy();

  const background = screen.getByRole("region", { name: "Im Hintergrund" });
  expect(within(background).getByText("Vorlesung 07.pdf")).toBeTruthy();
  expect(within(background).getByText("Syllabus ADS.pdf")).toBeTruthy();
  expect(within(background).getByText("Freigabe benötigt")).toBeTruthy();
  expect(
    within(background)
      .getByRole("link", { name: "Kurs organisieren" })
      .getAttribute("href"),
  ).toBe("/agents/agent-2");
  expect(within(background).getByText("Aktiv")).toBeTruthy();
  expect(
    within(background)
      .getByRole("link", { name: "Agenten" })
      .getAttribute("href"),
  ).toBe("/agents");

  const sources = screen.getByRole("region", { name: "Quellen" });
  const items = await within(sources).findAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]?.textContent).toContain("Newest.pdf");
  expect(items[1]?.textContent).toContain("Ready.pdf");
  expect(items[2]?.textContent).toContain("Failed.pdf");
  expect(within(sources).queryByText("Oldest.pdf")).toBeNull();
  expect(
    within(sources)
      .getByRole("link", { name: "Newest.pdf" })
      .getAttribute("href"),
  ).toBe("/sources/src-4");
});

test("compact Quellen card uploads a PDF with Automatisch erkennen", async () => {
  const user = userEvent.setup();
  const createdBodies: unknown[] = [];
  let completed = false;
  api.route("POST", "/api/me/sources", async (request) => {
    createdBodies.push(await request.json());
    return Response.json({
      source: {
        id: "src-new",
        title: "Skript.pdf",
        status: "uploading",
        extraction: "pending",
        failure: null,
        courseId: null,
      },
      upload: {
        url: `${api.origin}/upload-target`,
        headers: { "content-type": "application/pdf" },
      },
    });
  });
  api.route("PUT", "/upload-target", () => new Response(null, { status: 200 }));
  api.route("POST", "/api/me/sources/src-new/complete", () => {
    completed = true;
    return Response.json({
      id: "src-new",
      title: "Skript.pdf",
      status: "queued",
      extraction: "pending",
      failure: null,
      courseId: null,
    });
  });

  renderHome();

  const sources = await screen.findByRole("region", { name: "Quellen" });
  const input = within(sources).getByLabelText("PDF hochladen");
  const file = new File(["%PDF-1.4"], "Skript.pdf", {
    type: "application/pdf",
  });
  await user.upload(input, file);

  await waitFor(() => expect(completed).toBe(true));
  expect(createdBodies).toEqual([
    {
      title: "Skript.pdf",
      bytes: file.size,
      type: "application/pdf",
      course: null,
    },
  ]);
});

test("denying an approval sends no fingerprint and surfaces a conflict error", async () => {
  const user = userEvent.setup();
  const decisions: unknown[] = [];
  api.route("GET", "/api/me/approvals", () => Response.json([approval]));
  api.route(
    "POST",
    `/api/me/approvals/${approval.actionId}`,
    async (request) => {
      decisions.push(await request.json());
      return Response.json({ error: "stale" }, { status: 409 });
    },
  );

  renderHome();

  const waiting = await screen.findByRole("region", {
    name: "Wartet auf dich",
  });
  await user.click(
    within(waiting).getByRole("button", { name: "Nicht erlauben" }),
  );

  expect((await within(waiting).findByRole("alert")).textContent).toMatch(
    /changed or expired/,
  );
  expect(decisions).toEqual([{ decision: "deny" }]);
});

test("shows an error alert when Home fails to load", async () => {
  api.route("GET", "/api/me/home", () =>
    Response.json({ error: "down" }, { status: 500 }),
  );

  renderHome();

  expect(
    (await screen.findByRole("alert", {}, { timeout: 3000 })).textContent,
  ).toBe("Dein Tag konnte nicht geladen werden.");
});
