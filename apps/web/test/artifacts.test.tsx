import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ArtifactsScreen } from "@/features/artifacts/artifacts-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/artifacts",
}));

const statistics = crypto.randomUUID();
const micro = crypto.randomUUID();
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(() => {
  replace.mockReset();
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
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [
        course(statistics, "Statistics II", "fuchsia"),
        course(micro, "Microeconomics", "violet"),
      ],
    }),
  );
});

function course(id: string, title: string, color: string) {
  return {
    id,
    code: null,
    title,
    status: "accepted",
    semester: "2026-ws",
    color,
    entered: false,
    archived: false,
    next: null,
    lastActivityAt: null,
  };
}

function artifact(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    kind: "practice_set",
    status: "ready",
    failure: null,
    topicIds: [],
    obligationId: null,
    createdAt: daysAgo(5),
    openedAt: daysAgo(5),
    withdrawn: false,
    title: "Artefakt",
    courseId: statistics,
    count: null,
    version: 1,
    updatedAt: daysAgo(5),
    lastPractisedAt: null,
    shaky: false,
    ...overrides,
  };
}

function serveArtifacts(artifacts: unknown[]) {
  api.route("GET", "/api/me/artifacts", () => Response.json(artifacts));
}

function renderScreen(props: { kind?: string; pollMs?: number } = {}) {
  render(
    <TestProviders>
      <SidebarProvider>
        <ArtifactsScreen apiOrigin={api.origin} {...props} />
      </SidebarProvider>
    </TestProviders>,
  );
}

/** Each card's text, in the order shown. */
async function cards() {
  const list = await screen.findByRole("list", { name: "Artefakte" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

test("shows each Artifact as a card naming what it is, its Course and when the student last worked on it", async () => {
  serveArtifacts([
    artifact({
      title: "Hypothesentests",
      count: 12,
      lastPractisedAt: daysAgo(3),
      shaky: true,
    }),
    artifact({
      kind: "flashcards",
      title: "Kostenrechnung",
      count: 40,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    }),
    artifact({
      kind: "draft",
      title: "Geldpolitik nach 2008",
      courseId: micro,
      version: 2,
      updatedAt: daysAgo(2),
    }),
  ]);

  renderScreen();

  expect(await cards()).toEqual([
    "UnsicherHypothesentests12 Aufgaben in Statistics IIVor 3 Tagen geübt",
    "Kostenrechnung40 Karteikarten in Statistics IIVor 1 Tag erstellt",
    "Geldpolitik nach 2008Entwurf in MicroeconomicsVor 2 Tagen bearbeitet",
  ]);
});

test("says so when there are no Artifacts yet", async () => {
  serveArtifacts([]);
  renderScreen();

  expect(
    await screen.findByRole("heading", { name: "Noch keine Artefakte" }),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Erstelle ein Artefakt aus deinen Kursunterlagen oder bitte nunio im Chat darum.",
    ),
  ).toBeTruthy();
});

test("says so when none of the kind shown exist", async () => {
  serveArtifacts([artifact({ title: "Hypothesentests" })]);
  renderScreen({ kind: "critique" });

  expect(
    await screen.findByText("Du hast noch keine Artefakte dieses Typs."),
  ).toBeTruthy();
});

test("asks again while an Artifact is being made, until it is ready", async () => {
  const making = artifact({ title: "Hypothesentests", openedAt: null });
  let asked = 0;
  api.route("GET", "/api/me/artifacts", () =>
    Response.json([
      asked++ === 0 ? { ...making, status: "making" } : { ...making, count: 3 },
    ]),
  );

  renderScreen({ pollMs: 10 });

  expect(await screen.findByText("Wird erstellt")).toBeTruthy();
  expect(await screen.findByText("Neu")).toBeTruthy();
  expect(screen.getByText("3 Aufgaben in Statistics II")).toBeTruthy();
});

test("filters by kind from the address, and changes the address when the student picks another", async () => {
  serveArtifacts([
    artifact({ title: "Hypothesentests" }),
    artifact({ kind: "flashcards", title: "Kostenrechnung" }),
  ]);

  renderScreen({ kind: "flashcards" });

  expect((await cards()).map((text) => text?.split("Karteikarten")[0])).toEqual(
    ["Kostenrechnung"],
  );
  const filter = screen.getByRole("group", { name: "Nach Typ filtern" });
  expect(
    within(filter)
      .getByRole("button", { name: "Karteikarten" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await userEvent.click(
    within(filter).getByRole("button", { name: "Entwurf" }),
  );
  expect(replace).toHaveBeenLastCalledWith("/artifacts?kind=draft", {
    scroll: false,
  });
  await userEvent.click(within(filter).getByRole("button", { name: "Alle" }));
  expect(replace).toHaveBeenLastCalledWith("/artifacts", { scroll: false });
});

test("badges a card by where its making stands first, then whether it is new, then whether its Topics are shaky", async () => {
  const card = (title: string, overrides: Record<string, unknown>) =>
    artifact({ title, count: 1, shaky: true, ...overrides });
  serveArtifacts([
    card("Im Bau", { status: "making", openedAt: null, count: null }),
    card("Gescheitert", { status: "failed", failure: "maker_failed" }),
    card("Zurückgezogen", { withdrawn: true, count: null }),
    card("Frisch", { openedAt: null }),
    card("Wackelig", {}),
    card("Sicher", { shaky: false }),
  ]);

  renderScreen();

  expect(await cards()).toEqual([
    "Wird erstelltIm BauÜbungsset in Statistics IIVor 5 Tagen erstellt",
    "FehlgeschlagenGescheitert1 Aufgabe in Statistics IIVor 5 Tagen erstellt",
    "Quelle gelöschtZurückgezogenÜbungsset in Statistics IIVor 5 Tagen erstellt",
    "NeuFrisch1 Aufgabe in Statistics IIVor 5 Tagen erstellt",
    "UnsicherWackelig1 Aufgabe in Statistics IIVor 5 Tagen erstellt",
    "Sicher1 Aufgabe in Statistics IIVor 5 Tagen erstellt",
  ]);
});
