import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

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
    Response.json({
      interventions: [intervention],
      notices: [],
      briefings: [],
    }),
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
  renderInbox();
  return closings;
}

/** The open Interventions, as the Offene Hinweise tab lists them. */
async function openPanel() {
  await userEvent.click(
    await screen.findByRole("tab", { name: /Offene Hinweise/ }),
  );
  return screen.getByRole("tabpanel");
}

async function showTab(name: RegExp) {
  await userEvent.click(await screen.findByRole("tab", { name }));
  return screen.getByRole("tabpanel");
}

function renderInbox() {
  render(
    <TestProviders>
      <SidebarProvider>
        <InboxScreen apiOrigin={api.origin} />
      </SidebarProvider>
    </TestProviders>,
  );
}

test("dismissing records that the Intervention was not useful, and moves it to the Verlauf", async () => {
  const closings = serveInbox();
  const item = within(await openPanel()).getByRole("article", {
    name: "Freigabe abgelaufen: Lernblock für Problem sheet 1 verschieben",
  });

  await userEvent.click(
    within(item).getByRole("button", { name: "Nicht hilfreich" }),
  );

  expect(closings).toEqual([{ as: "dismissed" }]);
  await waitFor(() =>
    expect(
      within(screen.getByRole("tabpanel")).queryByRole("article"),
    ).toBeNull(),
  );
  const history = await showTab(/Verlauf/);
  const closed = within(history).getByRole("article", {
    name: "Freigabe abgelaufen: Lernblock für Problem sheet 1 verschieben",
  });
  expect(within(closed).getByText("Nicht hilfreich")).toBeTruthy();
});

test("acknowledging records only that the student noted it", async () => {
  const closings = serveInbox();
  const item = within(await openPanel()).getByRole("article", {
    name: /Freigabe abgelaufen/,
  });

  await userEvent.click(
    within(item).getByRole("button", { name: "Verstanden" }),
  );

  expect(closings).toEqual([{ as: "acknowledged" }]);
  await waitFor(() =>
    expect(
      within(screen.getByRole("tabpanel")).queryByRole("article"),
    ).toBeNull(),
  );
  const history = await showTab(/Verlauf/);
  expect(within(history).getByText("Verstanden")).toBeTruthy();
});

test("the Offene Hinweise tab counts the open Interventions; closed ones wait in the Verlauf", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        expired,
        {
          ...expired,
          id: "5c1e0a4e-0000-4000-8000-000000000004",
          state: "acknowledged",
          closedAt: "2026-11-10T08:00:00.000Z",
        },
      ],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  const tab = await screen.findByRole("tab", { name: "Offene Hinweise 1" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(
    within(screen.getByRole("tabpanel")).getAllByRole("article"),
  ).toHaveLength(1);
  expect(within(await showTab(/Verlauf/)).getAllByRole("article")).toHaveLength(
    1,
  );
});

test("a Shortfall says how much time is missing before its work is due, and leads to the Plan", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        {
          ...expired,
          kind: "shortfall",
          title: "Problem sheet 3",
          action: null,
          shortMinutes: 120,
        },
      ],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  const item = within(await openPanel()).getByRole("article", {
    name: "2 Std. fehlen für Problem sheet 3",
  });
  expect(within(item).getByText("Analysis I · Zeitmangel")).toBeTruthy();
  expect(
    within(item)
      .getByRole("link", { name: "Im Plan ansehen" })
      .getAttribute("href"),
  ).toBe("/plan");
});

test("a Disagreement is settled where the student reviews their Facts", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        { ...expired, kind: "disagreement", title: "Raum 101", action: null },
      ],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  const item = within(await openPanel()).getByRole("article", {
    name: "Quellen widersprechen sich zu Raum 101",
  });
  expect(
    within(item)
      .getByRole("link", { name: "In „Prüfen“ klären" })
      .getAttribute("href"),
  ).toBe("/review");
});

test("an Intervention about a Task Action names the Task, not a block", async () => {
  const task = (id: string, kind: string, title: string) => ({
    ...expired,
    id,
    title,
    action: {
      kind,
      work: { title, course: "Analysis I" },
      from: null,
      to: null,
    },
  });
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        task(
          "5c1e0a4e-0000-4000-8000-000000000002",
          "task.create",
          "Vorlesung nacharbeiten",
        ),
        {
          ...task(
            "5c1e0a4e-0000-4000-8000-000000000003",
            "task.reopen",
            "Blatt 3 nacharbeiten",
          ),
          kind: "unconfirmed",
        },
      ],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  const open = await openPanel();
  expect(
    within(open).getByRole("article", {
      name: "Freigabe abgelaufen: Aufgabe „Vorlesung nacharbeiten“ anlegen",
    }),
  ).toBeTruthy();
  expect(
    within(open).getByRole("article", {
      name: "nunio konnte nicht bestätigen: Aufgabe „Blatt 3 nacharbeiten“ wieder öffnen",
    }),
  ).toBeTruthy();
});

test("an Agent Run's Intervention names its Agent and how many Approvals wait, and opens that Run's Approvals", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        {
          ...expired,
          kind: "run_approvals",
          title: "Klausur vorbereiten",
          course: null,
          action: null,
          run: { id: "run-7", agentId: "agent-3", openApprovals: 2 },
        },
        {
          ...expired,
          id: "5c1e0a4e-0000-4000-8000-000000000009",
          kind: "run_approvals",
          title: "Kurs aufräumen",
          course: null,
          action: null,
          run: { id: "run-2", agentId: "agent-1", openApprovals: 0 },
          state: "lapsed",
          closedAt: "2026-11-10T08:00:00.000Z",
        },
      ],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  const item = within(await openPanel()).getByRole("article", {
    name: "Klausur vorbereiten braucht deine Freigabe (2)",
  });
  expect(
    within(item)
      .getByRole("link", { name: "Freigaben öffnen" })
      .getAttribute("href"),
  ).toBe("/agents/agent-3?run=run-7");
  expect(
    within(await showTab(/Verlauf/)).getByRole("article", {
      name: "Kurs aufräumen braucht deine Freigabe",
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
          title: "Raum 101",
          action: null,
          state: "lapsed",
          closedAt: "2026-11-10T08:00:00.000Z",
        },
      ],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  const item = within(await showTab(/Verlauf/)).getByRole("article", {
    name: "Quellen widersprechen sich zu Raum 101",
  });
  expect(within(item).getByText("Gilt nicht mehr")).toBeTruthy();
  expect(within(item).queryByRole("button")).toBeNull();
});

test("acknowledging and dismissing do not look alike", async () => {
  serveInbox();
  const item = within(await openPanel()).getByRole("article", {
    name: /Freigabe abgelaufen/,
  });

  const gotIt = within(item).getByRole("button", { name: "Verstanden" });
  const notUseful = within(item).getByRole("button", {
    name: "Nicht hilfreich",
  });
  expect(gotIt.className).not.toBe(notUseful.className);
});

const notice = {
  id: "7d2f0a4e-0000-4000-8000-000000000001",
  agentId: "agent-3",
  agentName: "Klausur vorbereiten",
  runId: "run-7",
  text: "Deine Klausur ist am 5. Februar." as string | null,
  sentAt: "2026-11-10T07:00:00.000Z",
  readAt: null as string | null,
  announcement: "announced",
};

/** Serves the given Notices and records each one the student opens. */
function serveNotices(...notices: (typeof notice)[]) {
  let shown = notices;
  const opened: string[] = [];
  api.route("GET", "/api/me/inbox", () =>
    Response.json({ interventions: [], notices: shown, briefings: [] }),
  );
  for (const n of notices)
    api.route("POST", `/api/me/notices/${n.id}/read`, () => {
      opened.push(n.id);
      shown = shown.map((s) =>
        s.id === n.id ? { ...s, readAt: "2026-11-10T08:00:00.000Z" } : s,
      );
      return Response.json({ status: "ok" });
    });
  renderInbox();
  return opened;
}

test("a Notice is its Agent's message, unread until the student opens it, which marks it read", async () => {
  const opened = serveNotices(notice);
  // Beside the open Interventions, which are none here.
  const messages = await screen.findByRole("region", { name: "Nachrichten" });
  const item = within(messages).getByRole("article", {
    name: "Nachricht von Klausur vorbereiten",
  });
  expect(within(item).getByText("Ungelesen")).toBeTruthy();
  expect(
    within(item).queryByText("Deine Klausur ist am 5. Februar."),
  ).toBeNull();
  expect(
    screen.queryByText("Nichts braucht gerade deine Aufmerksamkeit."),
  ).toBeNull();

  await userEvent.click(within(item).getByRole("button", { name: "Öffnen" }));

  expect(
    await within(item).findByText("Deine Klausur ist am 5. Februar."),
  ).toBeTruthy();
  expect(opened).toEqual([notice.id]);
  await waitFor(() => expect(within(item).queryByText("Ungelesen")).toBeNull());
});

test("a Notice's text is plain text: nothing in it becomes a link or formatting", async () => {
  const text = "**Fang** an: <b>jetzt</b> unter www.example.test\nZweite Zeile";
  serveNotices({ ...notice, text, readAt: "2026-11-10T07:30:00.000Z" });

  const item = await screen.findByRole("article", {
    name: "Nachricht von Klausur vorbereiten",
  });

  expect(
    within(item).getByText((_, element) => element?.textContent === text, {
      selector: "p",
    }),
  ).toBeTruthy();
  expect(within(item).queryByRole("link")).toBeNull();
  expect(item.querySelector("b, strong")).toBeNull();
  expect(within(item).queryByRole("button", { name: "Öffnen" })).toBeNull();
});

test("a Notice drawn from a Source deleted since says it can no longer be read", async () => {
  serveNotices({ ...notice, text: null, readAt: "2026-11-10T07:30:00.000Z" });

  const item = await screen.findByRole("article", {
    name: "Nachricht von Klausur vorbereiten",
  });

  expect(
    within(item).getByText(
      "Nicht mehr lesbar: Eine Quelle, die der Agent gelesen hatte, wurde gelöscht.",
    ),
  ).toBeTruthy();
});

test("a Notice whose marking as read fails can be opened again", async () => {
  serveNotices(notice);
  api.route(
    "POST",
    `/api/me/notices/${notice.id}/read`,
    () => new Response(null, { status: 500 }),
  );
  const item = await screen.findByRole("article", {
    name: "Nachricht von Klausur vorbereiten",
  });

  await userEvent.click(within(item).getByRole("button", { name: "Öffnen" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Konnte die Nachricht nicht öffnen.",
  );
  expect(within(item).getByRole("button", { name: "Öffnen" })).toBeTruthy();
  expect(within(item).getByText("Ungelesen")).toBeTruthy();
});

test("the Nachrichten tab counts the unread Notices and lists them all, as Alle anzeigen leads there", async () => {
  const notices = [1, 2, 3, 4].map((n) => ({
    ...notice,
    id: `7d2f0a4e-0000-4000-8000-00000000000${n}`,
    agentName: `Agent ${n}`,
    readAt: n === 4 ? "2026-11-10T07:30:00.000Z" : null,
  }));
  serveNotices(...notices);

  const side = await screen.findByRole("region", { name: "Nachrichten" });
  expect(within(side).getAllByRole("article")).toHaveLength(3);

  await userEvent.click(
    within(side).getByRole("button", { name: "Alle anzeigen" }),
  );

  const tab = screen.getByRole("tab", { name: "Nachrichten 3" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(
    within(screen.getByRole("tabpanel")).getAllByRole("article"),
  ).toHaveLength(4);
});

test("with nothing to attend to, the Inbox says so and leads to the Verlauf", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [{ ...expired, state: "acknowledged" }],
      notices: [],
      briefings: [],
    }),
  );
  renderInbox();

  expect(
    await screen.findByText("Nichts braucht gerade deine Aufmerksamkeit."),
  ).toBeTruthy();

  await userEvent.click(
    screen.getByRole("button", { name: "Verlauf ansehen" }),
  );

  expect(
    screen.getByRole("tab", { name: "Verlauf" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    within(screen.getByRole("tabpanel")).getByRole("article", {
      name: /Freigabe abgelaufen/,
    }),
  ).toBeTruthy();
});

test("an Agent Briefing shows plain text, live RunApprovalCard, unread Notice, and live Artifacts", async () => {
  const decidedCalls: unknown[] = [];
  const openedNotices: string[] = [];
  let approvalState: "waiting" | "approved" = "waiting";
  let noticeReadAt: string | null = null;
  const briefingText =
    "Morgenbriefing: **Alles** unter https://example.test\nZweite Zeile";

  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [{ ...expired, state: "acknowledged" }],
      notices: [
        {
          ...notice,
          readAt: noticeReadAt,
        },
      ],
      briefings: [
        {
          id: "b-agent-1",
          madeAt: "2026-11-10T06:05:00.000Z",
          agentId: "agent-briefing",
          agentName: "Morgen-Briefing",
          runId: "run-briefing-1",
          text: briefingText,
          announcement: "pending",
          interventions: [expired.id],
          approvals: [
            {
              actionId: "a-waiting",
              action: expired.action,
              fingerprint: approvalState === "waiting" ? "fp-123" : null,
              expiresAt: "2026-11-12T07:00:00.000Z",
              agent: { id: "agent-3", name: "Klausur vorbereiten" },
              state: approvalState,
            },
            {
              actionId: "a-withdrawn",
              action: expired.action,
              fingerprint: null,
              expiresAt: "2026-11-12T07:00:00.000Z",
              agent: { id: "agent-3", name: "Klausur vorbereiten" },
              state: "withdrawn",
            },
          ],
          agents: [],
          notices: [notice.id],
          artifacts: [
            {
              id: "art-1",
              kind: "flashcards",
              title: "Stochastik Karten",
              course: "Statistik II",
              count: 12,
              state: "ready",
            },
            {
              id: "art-2",
              kind: "practice_set",
              title: "Altes Set",
              course: "Analysis I",
              count: null,
              state: "withdrawn",
            },
          ],
        },
      ],
    }),
  );
  api.route("POST", "/api/me/approvals/a-waiting", async (request) => {
    decidedCalls.push(await request.json());
    approvalState = "approved";
    return Response.json({ status: "ok" });
  });
  api.route("POST", `/api/me/notices/${notice.id}/read`, () => {
    openedNotices.push(notice.id);
    noticeReadAt = "2026-11-10T08:00:00.000Z";
    return Response.json({ status: "ok" });
  });

  renderInbox();

  const panel = await showTab(/Briefings/);
  const card = within(panel).getByRole("article", {
    name: "Briefing von Morgen-Briefing",
  });
  expect(within(card).getByText("1 Freigabe offen")).toBeTruthy();

  // Plain text: never rendered as a link or formatting.
  expect(
    within(card).getByText((_, el) => el?.textContent === briefingText, {
      selector: "p",
    }),
  ).toBeTruthy();
  expect(card.querySelector("strong, b")).toBeNull();
  expect(
    within(card).queryByRole("link", { name: /example\.test/ }),
  ).toBeNull();

  // Live Intervention status and withdrawn Approval status.
  const notes = within(card).getByRole("region", { name: "Hinweise" });
  expect(within(notes).getByText("Verstanden")).toBeTruthy();
  const settled = within(card).getByRole("region", {
    name: "Freigaben · aktueller Stand",
  });
  expect(
    within(settled).getByText("Lernblock für Problem sheet 1 verschieben"),
  ).toBeTruthy();
  expect(within(settled).getByText("Zurückgezogen")).toBeTruthy();

  // Bundled Artifacts: ready one links to /artifacts/art-1, withdrawn one has no link.
  expect(
    within(card)
      .getByRole("link", { name: "Stochastik Karten" })
      .getAttribute("href"),
  ).toBe("/artifacts/art-1");
  const artifacts = within(card).getByRole("region", { name: "Artefakte" });
  expect(within(artifacts).getByText("Altes Set")).toBeTruthy();
  expect(within(artifacts).getByText("Übungsset · Analysis I")).toBeTruthy();
  expect(within(artifacts).getByText("Nicht mehr lesbar")).toBeTruthy();
  expect(within(card).queryByRole("link", { name: "Altes Set" })).toBeNull();

  // Bundled Notice stays unread until opened explicitly.
  const bundledNotice = within(card).getByRole("article", {
    name: "Nachricht von Klausur vorbereiten",
  });
  expect(within(bundledNotice).getByText("Ungelesen")).toBeTruthy();
  expect(openedNotices).toEqual([]);

  // Real RunApprovalCard: clicking Akzeptieren sends fingerprint and updates live status.
  await userEvent.click(
    within(card).getByRole("button", { name: "Akzeptieren" }),
  );
  expect(decidedCalls).toEqual([
    { decision: "approve", fingerprint: "fp-123" },
  ]);
  expect(await within(card).findByText("Freigegeben")).toBeTruthy();
  expect(within(card).queryByText("1 Freigabe offen")).toBeNull();

  // Opening the bundled Notice marks only that Notice read.
  await userEvent.click(
    within(bundledNotice).getByRole("button", { name: "Öffnen" }),
  );
  expect(openedNotices).toEqual([notice.id]);
  expect(
    await within(bundledNotice).findByText("Deine Klausur ist am 5. Februar."),
  ).toBeTruthy();
});

test("an Agent Briefing drawn from a deleted Source says it can no longer be read", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [],
      notices: [],
      briefings: [
        {
          id: "b-agent-shredded",
          madeAt: "2026-11-10T06:05:00.000Z",
          agentId: "agent-briefing",
          agentName: "Morgen-Briefing",
          runId: "run-briefing-2",
          text: null,
          announcement: "inbox_only",
          interventions: [],
          approvals: [],
          agents: [],
          notices: [],
          artifacts: [],
        },
      ],
    }),
  );

  renderInbox();

  const panel = await showTab(/Briefings/);
  const card = within(panel).getByRole("article", {
    name: "Briefing von Morgen-Briefing",
  });
  expect(
    within(card).getByText(
      "Nicht mehr lesbar: Eine Quelle, die der Agent gelesen hatte, wurde gelöscht.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByText("Nichts braucht gerade deine Aufmerksamkeit."),
  ).toBeNull();
});

test("the Briefings tab switches between Briefings via Letzte Briefings and renders past nunio Briefings", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [],
      notices: [],
      briefings: [
        {
          id: "b-agent-latest",
          madeAt: "2026-11-10T06:05:00.000Z",
          agentId: "agent-3",
          agentName: "Klausur vorbereiten",
          runId: "run-7",
          text: "Alles im Plan.",
          announcement: "announced",
          interventions: [],
          approvals: [],
          agents: [],
          notices: [],
          artifacts: [],
        },
        {
          id: "b-nunio-legacy",
          madeAt: "2026-11-09T07:00:00.000Z",
          agentId: null,
          agentName: null,
          runId: null,
          text: null,
          announcement: "announced",
          interventions: [],
          approvals: [],
          agents: [{ id: "agent-3", name: "Klausur vorbereiten" }],
          notices: [],
          artifacts: [],
        },
      ],
    }),
  );

  renderInbox();

  const panel = await showTab(/Briefings/);
  const rail = within(panel).getByRole("navigation", {
    name: "Letzte Briefings",
  });
  expect(
    within(panel).getByRole("article", {
      name: "Briefing von Klausur vorbereiten",
    }),
  ).toBeTruthy();

  const legacyButton = within(rail).getByRole("button", {
    name: /Briefing vom 9\. November/,
  });
  await userEvent.click(legacyButton);

  expect(legacyButton.getAttribute("aria-current")).toBe("true");
  const legacyCard = within(panel).getByRole("article", {
    name: "Briefing vom 9. November",
  });
  expect(
    within(legacyCard).getByRole("region", { name: "Agenten" }),
  ).toBeTruthy();
  expect(within(legacyCard).queryByText(/Nicht mehr lesbar/)).toBeNull();
});

test("opening the last unread Notice keeps the Hinweise column calm beside Nachrichten", async () => {
  serveNotices(notice);

  const side = await screen.findByRole("region", { name: "Nachrichten" });
  expect(screen.getByText("Keine offenen Hinweise.")).toBeTruthy();

  await userEvent.click(within(side).getByRole("button", { name: "Öffnen" }));

  await waitFor(() => expect(within(side).queryByText("Ungelesen")).toBeNull());
  expect(screen.getByText("Keine offenen Hinweise.")).toBeTruthy();
  expect(
    screen.queryByText("Nichts braucht gerade deine Aufmerksamkeit."),
  ).toBeNull();
});

test("the Inbox header links to notification settings", async () => {
  api.route("GET", "/api/me/inbox", () =>
    Response.json({ interventions: [], notices: [], briefings: [] }),
  );
  renderInbox();

  const link = await screen.findByRole("link", {
    name: "Benachrichtigungen einstellen",
  });
  expect(link.getAttribute("href")).toBe("/settings/notifications");
});
