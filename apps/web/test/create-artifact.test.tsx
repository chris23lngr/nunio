import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
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
const ids = {
  hypotheses: crypto.randomUUID(),
  intervals: crypto.randomUUID(),
  regression: crypto.randomUUID(),
  anova: crypto.randomUUID(),
  paper: crypto.randomUUID(),
  talk: crypto.randomUUID(),
};
/** What the student asked for, in order. */
let requested: unknown[] = [];
/** How often the list was loaded. */
let listed = 0;

beforeEach(() => {
  replace.mockReset();
  requested = [];
  listed = 0;
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
        course(micro, "Microeconomics", "2026-11-01T10:00:00.000Z"),
        course(statistics, "Statistics II", "2026-11-14T10:00:00.000Z"),
      ],
    }),
  );
  api.route("GET", "/api/me/artifacts", () => {
    listed++;
    return Response.json([]);
  });
  api.route("POST", "/api/me/artifacts", async (request) => {
    requested.push(await request.json());
    return Response.json(
      { artifactId: crypto.randomUUID(), runId: crypto.randomUUID() },
      { status: 202 },
    );
  });
  serveOptions(statistics, {
    topics: [
      topic(ids.hypotheses, "Hypothesentests", "shaky"),
      topic(ids.intervals, "Konfidenzintervalle", "disputed"),
      topic(ids.regression, "Lineare Regression", "solid"),
      topic(ids.anova, "Varianzanalyse", "not_yet_practiced"),
    ],
    obligations: [],
  });
});

function course(id: string, title: string, lastActivityAt: string | null) {
  return {
    id,
    code: null,
    title,
    status: "accepted",
    semester: "2026-ws",
    color: "violet",
    entered: false,
    archived: false,
    next: null,
    lastActivityAt,
  };
}

function topic(id: string, title: string, level: string) {
  return { id, title, level };
}

function serveOptions(
  courseId: string,
  options: { topics: unknown[]; obligations: unknown[] },
) {
  api.route("GET", `/api/me/courses/${courseId}/artifact-options`, () =>
    Response.json(options),
  );
}

function renderScreen(
  props: Partial<ComponentProps<typeof ArtifactsScreen>> = {},
) {
  render(
    <TestProviders>
      <SidebarProvider>
        <ArtifactsScreen apiOrigin={api.origin} create="1" {...props} />
      </SidebarProvider>
    </TestProviders>,
  );
}

const sheet = () => screen.findByRole("dialog", { name: "Artefakt erstellen" });
/** Whether each named Topic is chosen. */
const chosen = (...names: string[]) =>
  names.map((name) =>
    screen
      .getByRole("checkbox", { name: new RegExp(name) })
      .getAttribute("aria-checked"),
  );

function obligation(
  id: string,
  title: string,
  kind: string,
  date: string,
  aiUse: unknown,
) {
  return {
    id,
    title,
    kind,
    due: { date, time: null, timeZone: "Europe/Berlin" },
    aiUse,
  };
}
const conditional = {
  status: "conditional",
  level: "obligation",
  text: "KI-Werkzeuge dürfen für die Gliederung genutzt werden.",
  provenance: {
    kind: "source",
    sourceId: crypto.randomUUID(),
    title: "Modulhandbuch.pdf",
    page: 4,
  },
};
const allowed = {
  status: "allowed",
  level: "course",
  text: null,
  provenance: { kind: "entry" },
};

test("asks the student for an unknown AI-use Rule, records their answer at once, and then drafts", async () => {
  let rule: unknown = { status: "unknown", reason: "none" };
  const answers: unknown[] = [];
  api.route("GET", `/api/me/courses/${micro}/artifact-options`, () =>
    Response.json({
      topics: [],
      obligations: [
        obligation(
          ids.paper,
          "Geldpolitik nach 2008",
          "thesis",
          "2026-11-28",
          rule,
        ),
      ],
    }),
  );
  api.route(
    "POST",
    `/api/me/obligations/${ids.paper}/ai-use`,
    async (request) => {
      answers.push(await request.json());
      rule = allowed;
      return Response.json({ status: "ok" });
    },
  );
  renderScreen({ create: "draft", course: micro });
  const user = userEvent.setup();
  const question = await screen.findByRole("group", {
    name: "Darf KI für diese Abgabe genutzt werden?",
  });
  const draft = screen.getByRole("button", { name: "Entwurf erstellen" });

  expect(draft.hasAttribute("disabled")).toBe(true);
  await user.click(
    within(question).getByRole("radio", { name: "Den ganzen Kurs" }),
  );
  await user.click(within(question).getByRole("button", { name: "Erlaubt" }));

  await waitFor(() =>
    expect(answers).toEqual([{ level: "course", value: "allowed" }]),
  );
  await waitFor(() => expect(draft.hasAttribute("disabled")).toBe(false));
  await user.click(draft);
  await waitFor(() =>
    expect(requested).toEqual([
      {
        kind: "draft",
        obligationId: ids.paper,
        instructions: "",
        from: { selection: { courseIds: [micro], sourceIds: [] } },
      },
    ]),
  );
});

test("will not draft where the AI-use Rule forbids it, but lets the student change their answer", async () => {
  serveOptions(micro, {
    topics: [],
    obligations: [
      obligation(ids.paper, "Geldpolitik nach 2008", "thesis", "2026-11-28", {
        ...allowed,
        status: "forbidden",
        level: "obligation",
      }),
    ],
  });
  renderScreen({ create: "draft", course: micro });
  const user = userEvent.setup();

  expect(
    await screen.findByText("Dein Kurs erlaubt hier keine KI"),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Anweisungen" })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Entwurf erstellen" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Ändern" }));
  expect(
    screen.getByRole("group", {
      name: "Darf KI für diese Abgabe genutzt werden?",
    }),
  ).toBeTruthy();
});

test("asks for a Critique of the student's own text, offering no draft of nunio's where there is none", async () => {
  serveOptions(micro, {
    topics: [],
    obligations: [
      obligation(
        ids.paper,
        "Geldpolitik nach 2008",
        "thesis",
        "2026-11-28",
        allowed,
      ),
    ],
  });
  renderScreen({ create: "critique", course: micro });
  const user = userEvent.setup();
  const critique = await screen.findByRole("button", {
    name: "Kritik anfordern",
  });

  const ofNunio = await screen.findByRole("radio", {
    name: "Entwurf von nunio",
  });
  expect((ofNunio as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Noch kein Entwurf zu dieser Abgabe.")).toBeTruthy();
  expect(critique.hasAttribute("disabled")).toBe(true);
  await user.type(
    await screen.findByRole("textbox", { name: "Dein Text" }),
    "1. Einleitung",
  );
  await user.click(critique);

  await waitFor(() =>
    expect(requested).toEqual([
      {
        kind: "critique",
        obligationId: ids.paper,
        of: { ownWork: "1. Einleitung" },
        from: { selection: { courseIds: [micro], sourceIds: [] } },
      },
    ]),
  );
});

test("asks for a Critique of the latest version of nunio's draft for the Obligation", async () => {
  serveOptions(micro, {
    topics: [],
    obligations: [
      obligation(
        ids.paper,
        "Geldpolitik nach 2008",
        "thesis",
        "2026-11-28",
        allowed,
      ),
    ],
  });
  const draftId = crypto.randomUUID();
  const summary = {
    kind: "draft",
    status: "ready",
    failure: null,
    topicIds: [],
    obligationId: ids.paper,
    createdAt: "2026-11-03T10:00:00.000Z",
    openedAt: "2026-11-03T11:00:00.000Z",
    withdrawn: false,
    title: "Geldpolitik nach 2008",
    courseId: micro,
    count: null,
    updatedAt: "2026-11-05T10:00:00.000Z",
    lastPractisedAt: null,
    shaky: false,
  };
  api.route("GET", "/api/me/artifacts", () =>
    Response.json([
      { ...summary, id: draftId, version: 2 },
      { ...summary, id: crypto.randomUUID(), version: 1, withdrawn: true },
    ]),
  );
  renderScreen({ create: "critique", course: micro });
  const user = userEvent.setup();
  const ofNunio = await screen.findByRole("radio", {
    name: "Entwurf von nunio",
  });
  await waitFor(() =>
    expect((ofNunio as HTMLInputElement).disabled).toBe(false),
  );

  await user.click(ofNunio);
  // The withdrawn draft has no content left to comment on.
  expect(
    screen
      .getAllByRole("radio", { name: /Version/ })
      .map((radio) => radio.closest("label")?.textContent),
  ).toEqual(["Geldpolitik nach 2008 · Version 2 · 5. Nov."]);
  await user.click(screen.getByRole("button", { name: "Kritik anfordern" }));

  await waitFor(() =>
    expect(requested).toEqual([
      {
        kind: "critique",
        obligationId: ids.paper,
        of: { artifactId: draftId, version: 2 },
        from: { selection: { courseIds: [micro], sourceIds: [] } },
      },
    ]),
  );
});

test("shows the AI-use Rule anew when it changed before the student asked", async () => {
  let rule: unknown = allowed;
  api.route("GET", `/api/me/courses/${micro}/artifact-options`, () =>
    Response.json({
      topics: [],
      obligations: [
        obligation(
          ids.paper,
          "Geldpolitik nach 2008",
          "thesis",
          "2026-11-28",
          rule,
        ),
      ],
    }),
  );
  api.route("POST", "/api/me/artifacts", () => {
    rule = conditional;
    return Response.json({ error: "ai_use_conditions" }, { status: 409 });
  });
  renderScreen({ create: "draft", course: micro });
  const user = userEvent.setup();
  const draft = await screen.findByRole("button", {
    name: "Entwurf erstellen",
  });
  await waitFor(() => expect(draft.hasAttribute("disabled")).toBe(false));

  await user.click(draft);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Die KI-Regel dieser Abgabe hat sich geändert. Prüfe sie und versuche es noch einmal.",
  );
  expect(
    await screen.findByRole("checkbox", {
      name: "Ich halte mich an diese Bedingungen.",
    }),
  ).toBeTruthy();
  expect(draft.hasAttribute("disabled")).toBe(true);
  expect(replace).not.toHaveBeenCalled();
});

test("says when a Course has no Topics or no Obligation to write for", async () => {
  serveOptions(statistics, { topics: [], obligations: [] });
  renderScreen();
  const user = userEvent.setup();

  expect(
    await screen.findByText(
      "Für diesen Kurs kennt nunio noch keine Themen. Lade Unterlagen hoch, damit nunio sie findet.",
    ),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Übungsset erstellen" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await user.click(screen.getByRole("radio", { name: "Entwurf" }));
  expect(screen.getByText("Keine offene Abgabe in diesem Kurs.")).toBeTruthy();
});

test("keeps what the student entered when asking fails", async () => {
  serveOptions(micro, {
    topics: [],
    obligations: [
      obligation(
        ids.paper,
        "Geldpolitik nach 2008",
        "thesis",
        "2026-11-28",
        allowed,
      ),
    ],
  });
  api.route("POST", "/api/me/artifacts", () =>
    Response.json({ error: "boom" }, { status: 500 }),
  );
  renderScreen({ create: "draft", course: micro });
  const user = userEvent.setup();
  const instructions = await screen.findByRole("textbox", {
    name: "Anweisungen",
  });
  await user.type(instructions, "Nur Kapitel 2.");

  await user.click(screen.getByRole("button", { name: "Entwurf erstellen" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Das hat nicht geklappt. Versuche es noch einmal.",
  );
  expect((instructions as HTMLTextAreaElement).value).toBe("Nur Kapitel 2.");
  expect(replace).not.toHaveBeenCalled();
});

test("opens from the Erstellen button, keeping the list's filter in the address", async () => {
  renderScreen({ create: undefined, kind: "flashcards" });
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Erstellen" }));
  expect(replace).toHaveBeenLastCalledWith(
    "/artifacts?kind=flashcards&create=1",
    { scroll: false },
  );
});

test("starts with the kind the list is filtered by, and closes back to that list", async () => {
  renderScreen({ create: "1", kind: "flashcards" });
  const user = userEvent.setup();
  await sheet();

  expect(
    (screen.getByRole("radio", { name: "Karteikarten" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(replace).toHaveBeenLastCalledWith("/artifacts?kind=flashcards", {
    scroll: false,
  });
});

test("drafts for the soonest Obligation once the student confirms its AI-use conditions", async () => {
  serveOptions(micro, {
    topics: [],
    obligations: [
      obligation(
        ids.paper,
        "Geldpolitik nach 2008",
        "thesis",
        "2026-11-28",
        conditional,
      ),
      obligation(
        ids.talk,
        "Marktformen",
        "presentation",
        "2027-01-12",
        allowed,
      ),
    ],
  });
  renderScreen({ create: "draft", course: micro });
  const user = userEvent.setup();
  await sheet();

  const soonest = await screen.findByRole("radio", {
    name: /Geldpolitik nach 2008/,
  });
  expect((soonest as HTMLInputElement).checked).toBe(true);
  expect(
    screen.getByText(
      "„KI-Werkzeuge dürfen für die Gliederung genutzt werden.“",
    ),
  ).toBeTruthy();
  expect(screen.getByText("Aus Modulhandbuch.pdf, S. 4")).toBeTruthy();
  const draft = screen.getByRole("button", { name: "Entwurf erstellen" });
  await user.type(
    screen.getByRole("textbox", { name: "Anweisungen" }),
    "Nur die Gliederung.",
  );
  expect(draft.hasAttribute("disabled")).toBe(true);
  await user.click(
    screen.getByRole("checkbox", {
      name: "Ich halte mich an diese Bedingungen.",
    }),
  );
  await user.click(draft);

  await waitFor(() =>
    expect(requested).toEqual([
      {
        kind: "draft",
        obligationId: ids.paper,
        instructions: "Nur die Gliederung.",
        conditionsConfirmed: true,
        from: { selection: { courseIds: [micro], sourceIds: [] } },
      },
    ]),
  );
});

test("lets the student choose at most 20 Topics", async () => {
  const many = Array.from({ length: 21 }, (_, i) =>
    topic(crypto.randomUUID(), `Thema ${i + 1}`, "shaky"),
  );
  serveOptions(statistics, { topics: many, obligations: [] });
  renderScreen();
  const user = userEvent.setup();
  const last = await screen.findByRole("checkbox", { name: /^Thema 21\D/ });

  expect(screen.getByText("20 ausgewählt · bis zu 20")).toBeTruthy();
  expect(last.getAttribute("aria-disabled")).toBe("true");
  await user.click(screen.getByRole("checkbox", { name: /^Thema 1\D/ }));
  expect(last.getAttribute("aria-disabled")).not.toBe("true");
});

test("asks for a practice set on the Topics of the Course worked on last, the shaky and disputed ones already chosen", async () => {
  renderScreen();
  const user = userEvent.setup();
  await sheet();

  const course = await screen.findByRole("combobox", { name: "Kurs" });
  await waitFor(() => expect(course.textContent).toContain("Statistics II"));
  await screen.findByRole("checkbox", { name: /Hypothesentests/ });
  expect(
    chosen(
      "Hypothesentests",
      "Konfidenzintervalle",
      "Lineare Regression",
      "Varianzanalyse",
    ),
  ).toEqual(["true", "true", "false", "false"]);
  await user.click(screen.getByRole("checkbox", { name: /Varianzanalyse/ }));
  await user.click(screen.getByRole("button", { name: "Übungsset erstellen" }));

  await waitFor(() =>
    expect(requested).toEqual([
      {
        kind: "practice_set",
        topicIds: [ids.hypotheses, ids.intervals, ids.anova],
        from: { selection: { courseIds: [statistics], sourceIds: [] } },
      },
    ]),
  );
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith("/artifacts", { scroll: false }),
  );
  expect(listed).toBe(2);
  expect(within(document.body).queryByRole("alert")).toBeNull();
});
