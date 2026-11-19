import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentDetailScreen } from "@/features/agents/agent-detail-screen";
import { AgentActivity } from "@/features/agents/components/agent-activity";
import { api } from "./api";
import { TestProviders } from "./providers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/agents/a-1",
}));
beforeEach(() => {
  api.route("GET", "/api/me/agents/capabilities", () => Response.json([]));
  api.route("GET", "/api/me/agents/courses", () => Response.json([]));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

const agent = {
  id: "a-1",
  preset: null,
  name: "Klausur Statistik",
  description: "",
  emoji: "📊",
  instructions: "Bereite mich auf die Klausur vor.",
  courses: [],
  capabilities: [],
  course: null,
  exam: null,
  state: "active",
  pausedBy: null,
  running: false,
  grants: [],
  budget: { limitMicroUsd: 5_000_000, usedMicroUsd: 0, heldMicroUsd: 0 },
  recentActions: [],
  next: { runAt: null, action: null },
};

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
/** A Run as the list shows it, started `ago` minutes ago and, unless running, ended two minutes later. */
const listed = (
  id: string,
  ago: number,
  status: "running" | "done" | "stopped" | "failed",
  more: { stopReason?: string; openApprovals?: number } = {},
) => ({
  id,
  status,
  trigger: "schedule",
  startedAt: minutesAgo(ago),
  endedAt: status === "running" ? null : minutesAgo(ago - 2),
  stopReason: more.stopReason ?? null,
  openApprovals: more.openApprovals ?? 0,
});
const detail = (
  run: ReturnType<typeof listed>,
  more: {
    summary?: string;
    summaryGone?: boolean;
    costMicroUsd?: number;
    verlauf?: unknown[];
    approvals?: unknown[];
  } = {},
) => ({
  ...run,
  costMicroUsd: more.costMicroUsd ?? 0,
  budgetMicroUsd: 5_000_000,
  summary: more.summary ?? null,
  summaryGone: more.summaryGone ?? false,
  verlauf: more.verlauf ?? [
    { type: "start", at: run.startedAt, trigger: run.trigger },
  ],
  approvals: more.approvals ?? [],
});

/** A stat card's value. */
const stat = (label: string) =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

function renderScreen(ui: React.ReactNode) {
  return render(
    <TestProviders>
      <SidebarProvider>{ui}</SidebarProvider>
    </TestProviders>,
  );
}

test("an Agent that ran opens on Aktivität with its newest Run: Datum, Kosten, Status, Zusammenfassung and Verlauf", async () => {
  const stopped = listed("r-2", 60, "stopped", {
    stopReason: "budget_exhausted",
  });
  const done = listed("r-1", 1_500, "done");
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [stopped, done], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-2", () =>
    Response.json(
      detail(stopped, {
        costMicroUsd: 120_000,
        verlauf: [
          { type: "start", at: stopped.startedAt, trigger: "schedule" },
          {
            type: "read",
            at: stopped.startedAt,
            step: 1,
            plan: true,
            approvals: true,
            courses: [
              { id: "c-1", title: "Statistics II" },
              { id: "c-2", title: null },
            ],
            sources: [{ id: "s-1", title: null }],
          },
          {
            type: "action",
            at: stopped.startedAt,
            step: 2,
            capability: "createStudyBlocks",
            action: {
              kind: "studyBlock.create",
              work: { title: "Klausur Statistik", course: "Statistics II" },
              start: "2099-02-02T09:00:00.000Z",
              end: "2099-02-02T10:00:00.000Z",
            },
            outcome: "done",
            refusal: null,
            brokenPreferences: ["outside_study_window"],
          },
          {
            type: "action",
            at: stopped.startedAt,
            step: 2,
            capability: "createStudyBlocks",
            action: {
              kind: "studyBlock.create",
              work: null,
              start: "2099-02-03T09:00:00.000Z",
              end: "2099-02-03T10:00:00.000Z",
            },
            outcome: "refused",
            refusal: "run_cap",
            brokenPreferences: [],
          },
          {
            type: "action",
            at: stopped.startedAt,
            step: 2,
            capability: "createStudyBlocks",
            // An Action that places nothing in time, such as a Task, shows no times.
            action: {
              kind: "task.create",
              work: { title: "Übungsblatt 4", course: "Statistics II" },
              start: null,
              end: null,
            },
            outcome: "awaiting_approval",
            refusal: null,
            brokenPreferences: [],
          },
          {
            type: "action",
            at: stopped.startedAt,
            step: 2,
            capability: "createStudyBlocks",
            action: null,
            outcome: "refused",
            refusal: "invalid",
            brokenPreferences: [],
          },
          {
            type: "end",
            at: stopped.endedAt,
            status: "stopped",
            reason: "budget_exhausted",
          },
        ],
      }),
    ),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(
      detail(done, {
        summary: "Ich habe zwei Lernblöcke für deine Klausur eingetragen.",
      }),
    ),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  const tab = await screen.findByRole("tab", { name: "Aktivität" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  const rows = within(screen.getByRole("navigation", { name: "Läufe" }))
    .getAllByRole("button")
    .map((row) => [row.getAttribute("aria-current"), row.textContent]);
  expect(rows).toEqual([
    ["true", expect.stringMatching(/2 Min\.Gestoppt$/)],
    [null, expect.stringMatching(/2 Min\.$/)],
  ]);
  await screen.findByText("Kosten", { selector: "dt" });
  expect(stat("Kosten")).toBe("0,12 von 5,00 USD");
  expect(stat("Status")).toBe("Gestoppt");
  expect(stat("Datum")).toMatch(/^\d+\. \S+ \d{4}, \d\d:\d\d$/);
  const summary = screen.getByRole("region", { name: "Zusammenfassung" });
  expect(within(summary).getByText("Abgebrochen: Budget aufgebraucht"));
  const verlauf = within(screen.getByRole("list", { name: "Verlauf" }))
    .getAllByRole("listitem")
    .map((entry) => entry.textContent);
  expect(verlauf).toEqual([
    expect.stringContaining("Zur geplanten Zeit gestartet"),
    expect.stringMatching(
      /Hat den Plan gelesen, deine Freigaben gelesen, 2 Kurse gelesen und 1 Quelle aufgerufenKurse: Statistics II, gelöschtQuellen: gelöscht$/,
    ),
    expect.stringMatching(
      /Lernblock erstellt„Klausur Statistik“ · Statistics II · .+Immer erlaubt, obwohl: Außerhalb deines Lernfensters$/,
    ),
    expect.stringMatching(
      /Abgelehnt: Lernblock erstellengelöscht · .+Grund: Limit dieses Laufs erreicht$/,
    ),
    expect.stringMatching(
      /Freigabe angefragt: Lernblock erstellen„Übungsblatt 4“ · Statistics II$/,
    ),
    expect.stringMatching(
      /Abgelehnt: Lernblock erstellenGrund: Ungültige Angaben, nichts wurde gefragt$/,
    ),
    expect.stringMatching(/Abgebrochen: Budget aufgebraucht$/),
  ]);

  await userEvent.click(
    within(screen.getByRole("navigation", { name: "Läufe" })).getAllByRole(
      "button",
    )[1]!,
  );

  expect(
    await screen.findByText(
      "Ich habe zwei Lernblöcke für deine Klausur eingetragen.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("In den Worten deines Agenten")).toBeTruthy();
  expect(stat("Status")).toBe("Abgeschlossen");
});

test("an Agent that never ran opens on Auftrag", async () => {
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [], nextCursor: null }),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  const tab = await screen.findByRole("tab", { name: "Auftrag" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
});

test("the Run list shows each start's duration, 'Seit …' while running, and badges, loading older Runs on scroll", async () => {
  let scrolledToEnd: (() => void) | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        scrolledToEnd = () => callback([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  const running = listed("r-4", 5, "running");
  const pages = {
    first: [running, listed("r-3", 60, "stopped", { stopReason: "paused" })],
    older: [
      listed("r-2", 1_500, "done", { openApprovals: 2 }),
      listed("r-1", 3_000, "failed", { stopReason: "model_ended_early" }),
    ],
  };
  api.route("GET", "/api/me/agents/a-1/runs", (request) => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return Response.json(
      cursor === "older"
        ? { runs: pages.older, nextCursor: null }
        : { runs: pages.first, nextCursor: "older" },
    );
  });
  api.route("GET", "/api/me/agents/a-1/runs/r-4", () =>
    Response.json(detail(running)),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const list = await screen.findByRole("navigation", { name: "Läufe" });
  expect(
    within(list)
      .getAllByRole("button")
      .map((row) => row.textContent),
  ).toEqual([
    expect.stringMatching(/Seit 5 Min\.Läuft gerade$/),
    expect.stringMatching(/2 Min\.Gestoppt$/),
  ]);
  await screen.findByText("Status", { selector: "dt" });
  expect(stat("Status")).toBe("Läuft gerade");
  expect(screen.getByText("Dein Agent arbeitet noch.")).toBeTruthy();

  scrolledToEnd!();

  await waitFor(() =>
    expect(
      within(list)
        .getAllByRole("button")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringMatching(/Seit 5 Min\.Läuft gerade$/),
      expect.stringMatching(/2 Min\.Gestoppt$/),
      expect.stringMatching(/2 Min\.Freigabe benötigt$/),
      expect.stringMatching(/2 Min\.Fehlgeschlagen$/),
    ]),
  );
});

test("a done Run whose summary went with a deleted Source says so, unlike one that wrote none", async () => {
  const gone = listed("r-2", 60, "done");
  const none = listed("r-1", 120, "done");
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [gone, none], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-2", () =>
    Response.json(detail(gone, { summaryGone: true })),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(detail(none)),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  expect(
    await screen.findByText(
      "Zusammenfassung nicht mehr verfügbar: eine Quelle, aus der sie stammt, wurde gelöscht.",
    ),
  ).toBeTruthy();
  await userEvent.click(
    within(screen.getByRole("navigation", { name: "Läufe" })).getAllByRole(
      "button",
    )[1]!,
  );
  expect(await screen.findByText("Keine Zusammenfassung.")).toBeTruthy();
});

test("'Seit …' counts on while a Run is under way, even when nothing else changes", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setInterval", "clearInterval"],
    shouldAdvanceTime: true,
  });
  const running = listed("r-1", 5, "running");
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [running], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(detail(running)),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);
  const list = await screen.findByRole("navigation", { name: "Läufe" });
  expect(within(list).getByText("Seit 5 Min.")).toBeTruthy();

  await act(() => vi.advanceTimersByTimeAsync(60_000));

  expect(within(list).getByText("Seit 6 Min.")).toBeTruthy();
});

/** An open Approval of the Run as nunio renders it: a new block, or a move of one. */
const card = (
  actionId: string,
  action: {
    kind: "studyBlock.create" | "studyBlock.move";
    from: { start: string; end: string } | null;
    to: { start: string; end: string };
  },
) => ({
  actionId,
  action: {
    ...action,
    work: { title: "Klausur Statistik", course: "Statistics II" },
    task: null,
  },
  fingerprint: `fp-${actionId}`,
  expiresAt: "2099-02-09T08:00:00.000Z",
  agent: { id: "a-1", preset: "", name: "Klausurhelfer" },
});
const at = {
  monday: {
    start: "2099-02-02T09:00:00.000Z",
    end: "2099-02-02T10:00:00.000Z",
  },
  tuesday: {
    start: "2099-02-03T14:00:00.000Z",
    end: "2099-02-03T15:00:00.000Z",
  },
};

test("Freigaben shows the selected Run's open Approvals as nunio renders them, and Akzeptieren approves exactly the one shown", async () => {
  const run = listed("r-1", 60, "done", { openApprovals: 2 });
  const asked = [
    card("x-1", { kind: "studyBlock.create", from: null, to: at.monday }),
    card("x-2", {
      kind: "studyBlock.move",
      from: at.monday,
      to: at.tuesday,
    }),
  ];
  let approvals = asked;
  const decided: unknown[] = [];
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [run], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(detail(run, { summary: "Ich habe gefragt.", approvals })),
  );
  api.route("POST", "/api/me/approvals/x-1", async (request) => {
    decided.push(await request.json());
    approvals = asked.slice(1);
    return Response.json({ status: "ok" });
  });
  api.route("POST", "/api/me/approvals/x-2", async (request) => {
    decided.push(await request.json());
    approvals = [];
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const freigaben = await screen.findByRole("region", { name: "Freigaben" });
  const cards = within(freigaben).getAllByRole("group");
  expect(cards.map((c) => c.textContent)).toEqual([
    expect.stringMatching(
      /^Lernblock erstellen„Klausur Statistik“ · Statistics IINeu: Mo\., 2\. Feb\., \d\d:\d\d – \d\d:\d\d UhrKlausurhelfer · Läuft ab am Mo\., 9\. Feb\., \d\d:\d\dAblehnenAkzeptieren$/,
    ),
    expect.stringMatching(
      /^Lernblock verschieben„Klausur Statistik“ · Statistics IIMo\., 2\. Feb\., \d\d:\d\d – \d\d:\d\d Uhr → Di\., 3\. Feb\., \d\d:\d\d – \d\d:\d\d UhrKlausurhelfer · Läuft ab am .+AblehnenAkzeptieren$/,
    ),
  ]);
  // The Agent's own words stay in the Zusammenfassung, never on a card.
  expect(within(freigaben).queryByText(/Ich habe gefragt/)).toBeNull();

  await userEvent.click(
    within(cards[0]!).getByRole("button", { name: "Akzeptieren" }),
  );
  await waitFor(() =>
    expect(within(freigaben).getAllByRole("group")).toHaveLength(1),
  );
  await userEvent.click(
    within(freigaben).getByRole("button", { name: "Ablehnen" }),
  );

  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Freigaben" })).toBeNull(),
  );
  expect(decided).toEqual([
    { decision: "approve", fingerprint: "fp-x-1" },
    { decision: "deny" },
  ]);
});

test("an Approval whose Action changed says so and reloads instead of approving", async () => {
  const run = listed("r-1", 60, "done", { openApprovals: 1 });
  let approvals = [
    card("x-1", { kind: "studyBlock.move", from: at.monday, to: at.tuesday }),
  ];
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [run], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(detail(run, { approvals })),
  );
  api.route("POST", "/api/me/approvals/x-1", () => {
    // The gate refused it, so it is open no more.
    approvals = [];
    return Response.json({ error: "changed" }, { status: 409 });
  });
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const freigaben = await screen.findByRole("region", { name: "Freigaben" });
  await userEvent.click(
    within(freigaben).getByRole("button", { name: "Akzeptieren" }),
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Diese Aktion hat sich geändert, seit dein Agent gefragt hat. Nichts wurde ausgeführt; die Freigaben wurden neu geladen.",
  );
  await waitFor(() =>
    expect(within(freigaben).queryAllByRole("group")).toHaveLength(0),
  );
});

test("the Verlauf shows each Approval decided or expired, and what became of an approved one", async () => {
  const run = listed("r-1", 60, "done");
  const action = {
    kind: "studyBlock.create",
    work: { title: "Klausur Statistik", course: "Statistics II" },
    ...at.monday,
  };
  const decided = (more: object) => ({
    type: "approval",
    at: run.endedAt,
    action,
    outcome: null,
    refusal: null,
    ...more,
  });
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [run], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(
      detail(run, {
        verlauf: [
          decided({ decision: "approved", outcome: "done" }),
          decided({
            decision: "approved",
            outcome: "refused",
            refusal: "out_of_scope",
          }),
          decided({
            decision: "approved",
            outcome: "refused",
            refusal: "approval_mismatch",
          }),
          decided({ decision: "denied" }),
          decided({ decision: "expired" }),
        ],
      }),
    ),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const verlauf = await screen.findByRole("list", { name: "Verlauf" });
  expect(
    within(verlauf)
      .getAllByRole("listitem")
      .map((entry) => entry.textContent),
  ).toEqual([
    expect.stringMatching(
      /Von dir freigegeben: Lernblock erstellt„Klausur Statistik“ · Statistics II · .+$/,
    ),
    expect.stringMatching(
      /Freigegeben, nicht ausgeführt: Lernblock erstellen.+Grund: Keine Arbeit seiner Kurse$/,
    ),
    expect.stringMatching(
      /Freigegeben, nicht ausgeführt: Lernblock erstellen.+Grund: Hat sich seit der Frage geändert$/,
    ),
    expect.stringMatching(/Von dir abgelehnt: Lernblock erstellen„Klausur/),
    expect.stringMatching(/Freigabe abgelaufen: Lernblock erstellen„Klausur/),
  ]);
});
