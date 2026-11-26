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
  api.route("GET", "/api/me/models", () =>
    Response.json({ models: [], default: null, selected: null }),
  );
  // The Auftrag tab's builder panel reads whether the Allowance is left.
  api.route("GET", "/api/me/allowance", () =>
    Response.json({
      limitMicroUsd: 5_000_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    }),
  );
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
  name: "Klausur Statistik",
  description: "",
  emoji: "📊",
  instructions: "Bereite mich auf die Klausur vor.",
  courses: [],
  capabilities: [],
  state: "active",
  pausedBy: null,
  running: false,
  grants: [],
  budget: { limitMicroUsd: 5_000_000, usedMicroUsd: 0, heldMicroUsd: 0 },
  trigger: { rhythm: "daily", minute: 360 },
  modelKey: "sonnet-5.5-reasoning-high",
  next: { runAt: null },
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
    summaryGoneReason?: "source_deleted" | "connection_disconnected";
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
  summaryGoneReason: more.summaryGoneReason ?? null,
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
    ["true", expect.stringMatching(/^Gestoppt.+2 Min\.$/)],
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
  expect(stat("Status")).toBe("Abgeschlossen");
});

test("opened on one of its Runs, as the Inbox does, an Agent shows that Run in Aktivität", async () => {
  const newest = listed("r-2", 60, "done");
  const asking = listed("r-1", 1_500, "done", { openApprovals: 1 });
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [newest, asking], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(detail(asking)),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" run="r-1" />);

  const tab = await screen.findByRole("tab", { name: "Aktivität" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  const list = await screen.findByRole("navigation", { name: "Läufe" });
  expect(
    within(list)
      .getAllByRole("button")
      .map((row) => row.getAttribute("aria-current")),
  ).toEqual([null, "true"]);
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

test("opened to edit it, as the list's Bearbeiten does, an Agent that ran opens on Auftrag", async () => {
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [listed("r-1", 60, "done")], nextCursor: null }),
  );
  renderScreen(
    <AgentDetailScreen apiOrigin={api.origin} id="a-1" tab="auftrag" />,
  );

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
    expect.stringMatching(/^Läuft gerade.+Seit 5 Min\.$/),
    expect.stringMatching(/^Gestoppt.+2 Min\.$/),
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
      expect.stringMatching(/^Läuft gerade.+Seit 5 Min\.$/),
      expect.stringMatching(/^Gestoppt.+2 Min\.$/),
      expect.stringMatching(/^Freigabe benötigt.+2 Min\.$/),
      expect.stringMatching(/^Fehlgeschlagen.+2 Min\.$/),
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

test("a done Run whose summary went with a Disconnected Connection shows content from a disconnected Connection", async () => {
  const gone = listed("r-2", 60, "done");
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [gone], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-2", () =>
    Response.json(
      detail(gone, {
        summaryGone: true,
        summaryGoneReason: "connection_disconnected",
      }),
    ),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  expect(
    await screen.findByText("Inhalt aus einer getrennten Verbindung"),
  ).toBeTruthy();
  expect(screen.queryByText(/Zusammenfassung nicht mehr verfügbar/)).toBeNull();
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
  agent: { id: "a-1", name: "Klausurhelfer" },
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
      /^Lernblock erstellen„Klausur Statistik“ · Statistics IINeuMo\., 2\. Feb\., \d\d:\d\d – \d\d:\d\d UhrKlausurhelfer · Läuft ab am Mo\., 9\. Feb\., \d\d:\d\dAblehnenAkzeptieren$/,
    ),
    expect.stringMatching(
      /^Lernblock verschieben„Klausur Statistik“ · Statistics IIBisherMo\., 2\. Feb\., \d\d:\d\d – \d\d:\d\d UhrNeuDi\., 3\. Feb\., \d\d:\d\d – \d\d:\d\d UhrKlausurhelfer · Läuft ab am .+AblehnenAkzeptieren$/,
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

test("a Task's Approval toward an Obligation names that Obligation, on the card and in the Verlauf", async () => {
  const run = listed("r-1", 60, "done", { openApprovals: 1 });
  const action = {
    kind: "task.create",
    work: {
      title: "Altklausur rechnen",
      course: "Statistics II",
      obligation: "Klausur Statistik",
    },
  };
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [run], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(
      detail(run, {
        approvals: [
          {
            actionId: "x-1",
            action: {
              kind: action.kind,
              work: { title: "Altklausur rechnen", course: "Statistics II" },
              from: null,
              to: null,
              task: {
                role: null,
                minutes: null,
                event: null,
                obligation: "Klausur Statistik",
              },
            },
            fingerprint: "fp-x-1",
            expiresAt: "2099-02-09T08:00:00.000Z",
            agent: { id: "a-1", name: "Klausurhelfer" },
          },
        ],
        verlauf: [
          {
            type: "action",
            at: run.startedAt,
            step: 2,
            capability: "createTasks",
            action: { ...action, start: null, end: null },
            outcome: "awaiting_approval",
            refusal: null,
            brokenPreferences: [],
          },
        ],
      }),
    ),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const freigaben = await screen.findByRole("region", { name: "Freigaben" });
  expect(
    within(freigaben)
      .getAllByRole("group")
      .map((c) => c.textContent),
  ).toEqual([
    expect.stringMatching(
      /^Aufgabe anlegen„Altklausur rechnen“ · Statistics IIZählt für „Klausur Statistik“Klausurhelfer · Läuft ab am .+AblehnenAkzeptieren$/,
    ),
  ]);
  const verlauf = screen.getByRole("list", { name: "Verlauf" });
  expect(
    within(verlauf)
      .getAllByRole("listitem")
      .map((entry) => entry.textContent),
  ).toContainEqual(
    expect.stringMatching(
      /Freigabe angefragt: Aufgabe anlegen„Altklausur rechnen“ · für „Klausur Statistik“ · Statistics II$/,
    ),
  );
});

test("a Task's Approval shows its title, Course, Course Event and Estimate, and the Verlauf names the Task the Agent asked for", async () => {
  const run = listed("r-1", 60, "done", { openApprovals: 1 });
  const action = {
    kind: "task.create",
    work: { title: "Kapitel 3 lesen", course: "Statistics II" },
  };
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [run], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-1", () =>
    Response.json(
      detail(run, {
        approvals: [
          {
            actionId: "x-1",
            action: {
              ...action,
              from: null,
              to: null,
              task: {
                role: "preparation",
                minutes: 45,
                event: {
                  title: "Statistik Vorlesung",
                  start: at.monday.start,
                },
              },
            },
            fingerprint: "fp-x-1",
            expiresAt: "2099-02-09T08:00:00.000Z",
            agent: { id: "a-1", name: "Klausurhelfer" },
          },
        ],
        verlauf: [
          {
            type: "action",
            at: run.startedAt,
            step: 2,
            capability: "createTasks",
            action: { ...action, start: null, end: null },
            outcome: "awaiting_approval",
            refusal: null,
            brokenPreferences: [],
          },
        ],
      }),
    ),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const freigaben = await screen.findByRole("region", { name: "Freigaben" });
  expect(
    within(freigaben)
      .getAllByRole("group")
      .map((c) => c.textContent),
  ).toEqual([
    expect.stringMatching(
      /^Aufgabe anlegen„Kapitel 3 lesen“ · Statistics IIVorbereitung auf „Statistik Vorlesung“ am Mo\., 2\. Feb\., \d\d:\d\d · 45 Min\. geschätztKlausurhelfer · Läuft ab am .+AblehnenAkzeptieren$/,
    ),
  ]);
  const verlauf = screen.getByRole("list", { name: "Verlauf" });
  expect(
    within(verlauf)
      .getAllByRole("listitem")
      .map((entry) => entry.textContent),
  ).toContainEqual(
    expect.stringMatching(
      /Freigabe angefragt: Aufgabe anlegen„Kapitel 3 lesen“ · Statistics II$/,
    ),
  );
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

test("the Verlauf shows each Approval decided, expired or withdrawn, and what became of an approved one", async () => {
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
          decided({ decision: "withdrawn" }),
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
    expect.stringMatching(
      /Freigabe zurückgezogen: Lernblock erstellen„Klausur/,
    ),
  ]);
});

test("the Verlauf shows the flashcards or practice set a Run started, and why one did not start", async () => {
  const run = listed("r-1", 60, "done");
  const entry = (more: object) => ({
    type: "artifact",
    at: run.endedAt,
    step: 2,
    capability: "createFlashcards",
    kind: "flashcards",
    topics: [
      { id: "t-1", title: "Konfidenzintervalle" },
      { id: "t-2", title: null },
    ],
    outcome: "started",
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
          entry({
            capability: "createPracticeSets",
            kind: "practice_set",
            topics: [{ id: "t-1", title: "Konfidenzintervalle" }],
          }),
          entry({ outcome: "refused", refusal: "run_cap" }),
          entry({ outcome: "refused", refusal: "invalid", topics: [] }),
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
      /UhrÜbungsaufgaben gestartetThemen: Konfidenzintervalle$/,
    ),
    expect.stringMatching(
      /UhrNicht gestartet: KarteikartenThemen: Konfidenzintervalle, gelöschtGrund: Limit dieses Laufs erreicht$/,
    ),
    expect.stringMatching(
      /UhrNicht gestartet: KarteikartenGrund: Ungültige Angaben, nichts wurde gestartet$/,
    ),
  ]);
});

test("the Verlauf shows the Notice a Run sent, and why one was not sent, never its text", async () => {
  const run = listed("r-1", 60, "done");
  const entry = (more: object) => ({
    type: "notice",
    at: run.endedAt,
    step: 1,
    capability: "notifyStudent",
    outcome: "sent",
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
          entry({}),
          entry({ outcome: "refused", refusal: "run_cap" }),
          entry({ outcome: "refused", refusal: "invalid" }),
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
    expect.stringMatching(/UhrNachricht an dich gesendetIn deiner Inbox$/),
    expect.stringMatching(
      /UhrNicht gesendet: NachrichtGrund: Limit dieses Laufs erreicht$/,
    ),
    expect.stringMatching(
      /UhrNicht gesendet: NachrichtGrund: Ungültiger Text, nichts wurde gesendet$/,
    ),
  ]);
});

test("the Verlauf shows when a Run read the Inbox and wrote or refused a Briefing, never its text", async () => {
  const run = listed("r-1", 60, "done");
  const entry = (more: object) => ({
    type: "briefing",
    at: run.endedAt,
    step: 1,
    capability: "createBriefing",
    outcome: "written",
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
          {
            type: "read",
            at: run.startedAt,
            step: 1,
            plan: false,
            approvals: false,
            inbox: true,
            courses: [],
            sources: [],
          },
          entry({}),
          entry({ outcome: "refused", refusal: "nothing_open" }),
          entry({ outcome: "refused", refusal: "run_cap" }),
          entry({ outcome: "refused", refusal: "invalid" }),
        ],
      }),
    ),
  );
  renderScreen(<AgentActivity apiOrigin={api.origin} agentId="a-1" />);

  const verlauf = await screen.findByRole("list", { name: "Verlauf" });
  expect(
    within(verlauf)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    expect.stringMatching(/UhrHat die Inbox gelesen$/),
    expect.stringMatching(/UhrBriefing erstelltIn deiner Inbox$/),
    expect.stringMatching(
      /UhrKein Briefing erstelltGrund: Nichts Offenes zum Bündeln$/,
    ),
    expect.stringMatching(
      /UhrKein Briefing erstelltGrund: Limit dieses Laufs erreicht$/,
    ),
    expect.stringMatching(
      /UhrKein Briefing erstelltGrund: Ungültige Angaben, nichts wurde erstellt$/,
    ),
  ]);
});

test("a Run under way when nunio made its Agent from an earlier delegation reads as stopped by that, its Actions and expired Approval still shown", async () => {
  const old = listed("r-old", 2_000, "stopped", { stopReason: "conversion" });
  const block = (day: number) => ({
    start: `2099-01-0${day}T09:00:00.000Z`,
    end: `2099-01-0${day}T10:00:00.000Z`,
  });
  api.route("GET", "/api/me/agents/a-1", () =>
    Response.json({ ...agent, state: "paused", pausedBy: "conversion" }),
  );
  api.route("GET", "/api/me/agents/a-1/runs", () =>
    Response.json({ runs: [old], nextCursor: null }),
  );
  api.route("GET", "/api/me/agents/a-1/runs/r-old", () =>
    Response.json(
      detail(old, {
        verlauf: [
          { type: "start", at: old.startedAt, trigger: "schedule" },
          {
            type: "action",
            at: old.startedAt,
            step: 1,
            capability: "createStudyBlocks",
            action: {
              kind: "studyBlock.create",
              work: { title: "Klausur Analysis", course: "Analysis I" },
              ...block(1),
            },
            outcome: "done",
            refusal: null,
            brokenPreferences: [],
          },
          {
            type: "end",
            at: old.endedAt,
            status: "stopped",
            reason: "conversion",
          },
          {
            type: "approval",
            at: old.endedAt,
            action: {
              kind: "studyBlock.move",
              work: { title: "Klausur Analysis", course: "Analysis I" },
              ...block(2),
            },
            decision: "expired",
            outcome: null,
            refusal: null,
          },
        ],
      }),
    ),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  await screen.findByText("Kosten", { selector: "dt" });
  expect(screen.getByText("Übernommen: prüfen und fortsetzen")).toBeTruthy();
  const verlauf = within(screen.getByRole("list", { name: "Verlauf" }))
    .getAllByRole("listitem")
    .map((entry) => entry.textContent);
  expect(verlauf).toEqual([
    expect.stringContaining("Zur geplanten Zeit gestartet"),
    expect.stringContaining("Lernblock erstellt„Klausur Analysis“"),
    expect.stringMatching(/Abgebrochen: In einen Agenten übernommen$/),
    expect.stringContaining("Freigabe abgelaufen"),
  ]);
});
