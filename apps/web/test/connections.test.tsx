import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ConnectionsScreen } from "@/features/settings/connections-screen";
import { leaveTo } from "@/lib/navigation";
import { api } from "./api";
import { TestProviders } from "./providers";

vi.mock("@/lib/navigation", () => ({ leaveTo: vi.fn() }));
beforeEach(() => vi.mocked(leaveTo).mockClear());

const email = {
  key: "email",
  name: "E-Mail",
  logo: "/integrations/email.svg",
  description:
    "Mails deiner Uni-Adresse durchsuchen und lesen, nach deiner Freigabe senden",
  dataNote: "Daten werden von deiner Hochschule verarbeitet",
  kind: "email",
  connection: null,
  tools: [
    { label: "Mails durchsuchen", class: "read" },
    { label: "Mail senden", class: "write_always_asked" },
  ],
};
const testnotizen = {
  key: "testnotizen",
  name: "Testnotizen",
  logo: "/integrations/testnotizen.svg",
  description: "Notizen durchsuchen und lesen, Seiten anlegen",
  dataNote: "Test-Dienst, Daten bleiben auf deinem Rechner",
  kind: "mcp",
  connection: null,
  tools: [
    { label: "Seite anlegen", class: "write" },
    { label: "Notiz lesen", class: "read" },
    { label: "Notizen durchsuchen", class: "read" },
    { label: "Notiz teilen", class: "write_always_asked" },
  ],
};

function renderConnections(
  returned?: Parameters<typeof ConnectionsScreen>[0]["returned"],
) {
  return render(
    <TestProviders>
      <ConnectionsScreen apiOrigin={api.origin} returned={returned} />
    </TestProviders>,
  );
}

test("shows no Connections yet and each offered Integration under Verfügbar", async () => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email, testnotizen] }),
  );
  renderConnections();

  const available = within(
    await screen.findByRole("region", { name: "Verfügbar" }),
  );
  expect(
    available.getByText(
      "Von nunio geprüfte Dienste. Du meldest dich einmal an, danach entscheidest du pro Chat und Agent.",
    ),
  ).toBeTruthy();
  const rows = available.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  const first = within(rows[0]!);
  expect(first.getByText("E-Mail")).toBeTruthy();
  expect(
    first.getByText(
      "Mails deiner Uni-Adresse durchsuchen und lesen, nach deiner Freigabe senden · Daten werden von deiner Hochschule verarbeitet",
    ),
  ).toBeTruthy();
  expect(rows[0]!.querySelector("img")?.getAttribute("src")).toBe(
    "/integrations/email.svg",
  );
  expect(first.getByRole("button", { name: "Verbinden" })).toBeTruthy();
  expect(
    within(rows[1]!)
      .getByRole("button", { name: "Verbinden" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(within(rows[1]!).getByText("Testnotizen")).toBeTruthy();

  const connected = within(screen.getByRole("region", { name: "Verbunden" }));
  expect(
    connected.getByText(
      "Dienste, die nunio in Chats und Agents für dich nutzen darf.",
    ),
  ).toBeTruthy();
  expect(
    connected.getByText("Du hast noch keine Dienste verbunden."),
  ).toBeTruthy();
});

test("names Verbindungen as the current settings page", async () => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [] }),
  );
  renderConnections();

  const navigation = within(
    screen.getByRole("navigation", { name: "Einstellungen" }),
  );
  expect(
    navigation
      .getByRole("link", { name: "Verbindungen" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    navigation.getByRole("link", { name: "Verbindungen" }).getAttribute("href"),
  ).toBe("/settings/connections");
  expect(
    await screen.findByText("Gerade bietet nunio keine Dienste an."),
  ).toBeTruthy();
});

test("offers a retry when the catalog cannot be loaded", async () => {
  let fail = true;
  api.route("GET", "/api/me/integrations", () =>
    fail
      ? Response.json({ error: "internal" }, { status: 500 })
      : Response.json({ integrations: [email] }),
  );
  const user = userEvent.setup();
  renderConnections();

  expect(
    await screen.findByText(
      "Die Verbindungen konnten nicht geladen werden.",
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  expect(await screen.findByText("E-Mail")).toBeTruthy();
});

const connectedEmail = {
  ...email,
  connection: {
    state: "connected",
    accountLabel: "j.schuhmacher@stud.uni-heidelberg.de",
    folders: ["INBOX", "Lehrstuhl"],
    agentCount: 2,
  },
};

const folders = [
  { path: "INBOX", name: "INBOX", specialUse: "\\Inbox", preselected: true },
  {
    path: "Lehrstuhl",
    name: "Lehrstuhl",
    specialUse: null,
    preselected: false,
  },
  { path: "Sent", name: "Sent", specialUse: "\\Sent", preselected: false },
];

const heidelberg = {
  status: "recognised",
  university: "Universität Heidelberg",
  imap: { host: "imap.urz.uni-heidelberg.de", port: 993 },
  smtp: { host: "mail.urz.uni-heidelberg.de", port: 587 },
};

/** Opens the Email Connect dialog from Verfügbar. */
async function openEmailDialog(user: ReturnType<typeof userEvent.setup>) {
  const available = within(
    await screen.findByRole("region", { name: "Verfügbar" }),
  );
  const row = available.getByText("E-Mail").closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Verbinden" }));
  return within(
    await screen.findByRole("dialog", { name: "E-Mail verbinden" }),
  );
}

test("shows a connected Email under Verbunden with what it reads", async () => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [connectedEmail, testnotizen] }),
  );
  renderConnections();

  const connected = within(
    await screen.findByRole("region", { name: "Verbunden" }),
  );
  const [row] = connected.getAllByRole("listitem");
  const email = within(row!);
  expect(
    email.getByText("E-Mail · j.schuhmacher@stud.uni-heidelberg.de"),
  ).toBeTruthy();
  expect(
    email.getByText(
      "Lesen: Posteingang, Lehrstuhl · 2 Agents nutzen diese Verbindung",
    ),
  ).toBeTruthy();
  expect(email.getByText("Verbunden")).toBeTruthy();
  expect(
    email.getByRole("link", { name: "Verwalten" }).getAttribute("href"),
  ).toBe("/settings/connections/email");
  const available = within(screen.getByRole("region", { name: "Verfügbar" }));
  expect(available.queryByText("E-Mail")).toBeNull();
});

test("connects Email: recognises the university, tests reading and sending, then saves the chosen folders", async () => {
  let connected = false;
  const requests: Record<string, unknown> = {};
  api.route("GET", "/api/me/integrations", () =>
    Response.json({
      integrations: [connected ? connectedEmail : email, testnotizen],
    }),
  );
  api.route("POST", "/api/me/connections/email/discover", async (request) => {
    requests.discover = await request.json();
    return Response.json(heidelberg);
  });
  api.route("POST", "/api/me/connections/email/test", async (request) => {
    requests.test = await request.json();
    return Response.json({ folders });
  });
  api.route("POST", "/api/me/connections/email", async (request) => {
    requests.connect = await request.json();
    connected = true;
    return Response.json(
      { connection: connectedEmail.connection },
      { status: 201 },
    );
  });
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openEmailDialog(user);
  expect(
    dialog.getByText(
      "nunio liest Mails aus den Ordnern, die du auswählst, und sendet nur, nachdem du zugestimmt hast.",
    ),
  ).toBeTruthy();
  // The footer: the data note and nunio's two fixed lines, and nothing to tick.
  expect(
    dialog.getByText("Daten werden von deiner Hochschule verarbeitet."),
  ).toBeTruthy();
  expect(
    dialog.getByText(
      "Was nunio liest, geht ohne Speicherung beim Anbieter an das KI-Modell.",
    ),
  ).toBeTruthy();
  expect(
    dialog.getByText(
      "nunio speichert es verschlüsselt, bis du den Chat löschst oder die Verbindung trennst.",
    ),
  ).toBeTruthy();
  expect(dialog.queryByRole("checkbox")).toBeNull();

  await user.type(
    dialog.getByLabelText("E-Mail-Adresse"),
    "j.schuhmacher@stud.uni-heidelberg.de",
  );
  await user.click(dialog.getByLabelText("Passwort"));
  expect(
    await dialog.findByText(
      "Universität Heidelberg erkannt · imap.urz.uni-heidelberg.de",
    ),
  ).toBeTruthy();
  expect(requests.discover).toEqual({
    address: "j.schuhmacher@stud.uni-heidelberg.de",
  });
  expect(dialog.getByRole("button", { name: "Server ändern" })).toBeTruthy();
  expect(
    dialog.getByText(
      "Dein Uni-Passwort für E-Mail. nunio speichert es verschlüsselt.",
    ),
  ).toBeTruthy();
  await user.type(dialog.getByLabelText("Passwort"), "geheim");
  expect(dialog.queryByRole("button", { name: "Verbinden" })).toBeNull();
  await user.click(dialog.getByRole("button", { name: "Anmeldung prüfen" }));

  const checked = within(
    await dialog.findByRole("status", { name: "Anmeldung geprüft" }),
  );
  expect(checked.getByText("Lesen (IMAP)")).toBeTruthy();
  expect(checked.getByText("Senden (SMTP)")).toBeTruthy();
  expect(requests.test).toEqual({
    address: "j.schuhmacher@stud.uni-heidelberg.de",
    password: "geheim",
  });
  const chips = within(
    dialog.getByRole("group", { name: "Ordner, die nunio lesen darf" }),
  );
  const inbox = chips.getByRole("button", { name: "Posteingang" });
  const lehrstuhl = chips.getByRole("button", { name: "Lehrstuhl" });
  const sent = chips.getByRole("button", { name: "Sent" });
  expect(inbox.getAttribute("aria-pressed")).toBe("true");
  expect(lehrstuhl.getAttribute("aria-pressed")).toBe("false");
  expect(sent.getAttribute("aria-pressed")).toBe("false");
  await user.click(lehrstuhl);
  expect(lehrstuhl.getAttribute("aria-pressed")).toBe("true");

  await user.click(dialog.getByRole("button", { name: "Verbinden" }));

  expect(
    await screen.findByText("E-Mail · j.schuhmacher@stud.uni-heidelberg.de"),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(requests.connect).toEqual({
    address: "j.schuhmacher@stud.uni-heidelberg.de",
    password: "geheim",
    folders: ["INBOX", "Lehrstuhl"],
  });
});

test("connects an unknown domain through the manual form, and Server ändern opens it too", async () => {
  let tested: unknown;
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email] }),
  );
  api.route("POST", "/api/me/connections/email/discover", async (request) => {
    const { address } = (await request.json()) as { address: string };
    return Response.json(
      address.endsWith("@cs.example") ? { status: "unknown" } : heidelberg,
    );
  });
  api.route("POST", "/api/me/connections/email/test", async (request) => {
    tested = await request.json();
    return Response.json({ folders });
  });
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openEmailDialog(user);
  const address = dialog.getByLabelText("E-Mail-Adresse");
  await user.type(address, "lea@stud.uni-heidelberg.de");
  await user.tab();
  await user.click(
    await dialog.findByRole("button", { name: "Server ändern" }),
  );
  // Prefilled with what nunio recognised.
  expect((dialog.getByLabelText("IMAP-Server") as HTMLInputElement).value).toBe(
    "imap.urz.uni-heidelberg.de",
  );
  expect((dialog.getByLabelText("SMTP-Port") as HTMLInputElement).value).toBe(
    "587",
  );

  await user.clear(address);
  await user.type(address, "lea@cs.example");
  await user.tab();
  expect(
    await dialog.findByText(
      "nunio kennt die Server dieser Adresse nicht. Trag sie hier ein.",
    ),
  ).toBeTruthy();
  const imapHost = dialog.getByLabelText("IMAP-Server");
  await user.clear(imapHost);
  await user.type(imapHost, "imap.cs.example");
  const smtpHost = dialog.getByLabelText("SMTP-Server");
  await user.clear(smtpHost);
  await user.type(smtpHost, "smtp.cs.example");
  const smtpPort = dialog.getByLabelText("SMTP-Port");
  await user.clear(smtpPort);
  await user.type(smtpPort, "465");
  await user.type(dialog.getByLabelText("Benutzername"), "lea42");
  await user.type(dialog.getByLabelText("Passwort"), "geheim");
  await user.click(dialog.getByRole("button", { name: "Anmeldung prüfen" }));

  expect(
    await dialog.findByRole("status", { name: "Anmeldung geprüft" }),
  ).toBeTruthy();
  expect(tested).toEqual({
    address: "lea@cs.example",
    password: "geheim",
    username: "lea42",
    servers: {
      imap: { host: "imap.cs.example", port: 993 },
      smtp: { host: "smtp.cs.example", port: 465 },
    },
  });
});

test("tells a student whose university's mail nunio can't connect yet", async () => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email] }),
  );
  api.route("POST", "/api/me/connections/email/discover", () =>
    Response.json({ status: "unsupported", university: "Exchange Online" }),
  );
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openEmailDialog(user);
  await user.type(dialog.getByLabelText("E-Mail-Adresse"), "lea@hsbi.de");
  await user.tab();

  expect(
    await dialog.findByText("Diese Uni-Mail kann nunio noch nicht verbinden."),
  ).toBeTruthy();
  expect(
    dialog
      .getByRole("button", { name: "Anmeldung prüfen" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test.each([
  [
    "imap",
    "Lesen (IMAP) hat nicht geklappt. Prüfe Passwort, Benutzername und Server.",
  ],
  ["smtp", "Senden (SMTP) hat nicht geklappt. Prüfe den SMTP-Server."],
])("names the step that failed: %s", async (step, message) => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email] }),
  );
  api.route("POST", "/api/me/connections/email/discover", () =>
    Response.json(heidelberg),
  );
  api.route("POST", "/api/me/connections/email/test", () =>
    Response.json({ error: "login_failed", step }, { status: 422 }),
  );
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openEmailDialog(user);
  // A space typed around the address doesn't matter.
  await user.type(
    dialog.getByLabelText("E-Mail-Adresse"),
    " lea@stud.uni-heidelberg.de ",
  );
  expect(dialog.queryByLabelText("Benutzername")).toBeNull();
  await user.type(dialog.getByLabelText("Passwort"), "falsch");
  await user.click(dialog.getByRole("button", { name: "Anmeldung prüfen" }));

  const failed = within(
    await dialog.findByRole("alert", { name: "Anmeldung fehlgeschlagen" }),
  );
  expect(failed.getByText(message)).toBeTruthy();
  const imap = failed.getByText("Lesen (IMAP)");
  const smtp = failed.queryByText("Senden (SMTP)");
  if (step === "imap") {
    expect(imap.closest("[data-outcome]")?.getAttribute("data-outcome")).toBe(
      "failed",
    );
    expect(smtp).toBeNull();
  } else {
    expect(imap.closest("[data-outcome]")?.getAttribute("data-outcome")).toBe(
      "ok",
    );
    expect(smtp?.closest("[data-outcome]")?.getAttribute("data-outcome")).toBe(
      "failed",
    );
  }
  expect(
    dialog.queryByRole("group", { name: "Ordner, die nunio lesen darf" }),
  ).toBeNull();
  expect(dialog.queryByRole("button", { name: "Verbinden" })).toBeNull();
  // When reading fails, the login may be an account name rather than the address.
  expect(dialog.queryByLabelText("Benutzername") !== null).toBe(
    step === "imap",
  );
});

test("asks for the login after reading failed, and tests again with it", async () => {
  const tested: unknown[] = [];
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email] }),
  );
  api.route("POST", "/api/me/connections/email/discover", () =>
    Response.json(heidelberg),
  );
  api.route("POST", "/api/me/connections/email/test", async (request) => {
    const body = (await request.json()) as { username?: string };
    tested.push(body);
    return body.username
      ? Response.json({ folders })
      : Response.json({ error: "login_failed", step: "imap" }, { status: 422 });
  });
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openEmailDialog(user);
  await user.type(
    dialog.getByLabelText("E-Mail-Adresse"),
    "lea@stud.uni-heidelberg.de",
  );
  await user.type(dialog.getByLabelText("Passwort"), "geheim");
  await user.click(dialog.getByRole("button", { name: "Anmeldung prüfen" }));
  await user.type(await dialog.findByLabelText("Benutzername"), "hd123");
  await user.click(dialog.getByRole("button", { name: "Anmeldung prüfen" }));

  expect(
    await dialog.findByRole("status", { name: "Anmeldung geprüft" }),
  ).toBeTruthy();
  expect(tested).toEqual([
    { address: "lea@stud.uni-heidelberg.de", password: "geheim" },
    {
      address: "lea@stud.uni-heidelberg.de",
      password: "geheim",
      username: "hd123",
    },
  ]);
});

test.each([
  [
    429,
    "too_many_attempts",
    "Zu viele Anmeldeversuche. Versuch es in einer Viertelstunde noch einmal.",
  ],
  [
    403,
    "not_entitled",
    "Ohne aktiven Pilotzugang kann nunio keine E-Mail verbinden.",
  ],
  [403, "deletion_pending", "Für dieses Konto wurde die Löschung angefordert."],
])("explains a %i %s refusal", async (status, error, message) => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email] }),
  );
  api.route("POST", "/api/me/connections/email/discover", () =>
    Response.json(heidelberg),
  );
  api.route("POST", "/api/me/connections/email/test", () =>
    Response.json({ error }, { status }),
  );
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openEmailDialog(user);
  await user.type(
    dialog.getByLabelText("E-Mail-Adresse"),
    "lea@stud.uni-heidelberg.de",
  );
  await user.type(dialog.getByLabelText("Passwort"), "geheim");
  await user.click(dialog.getByRole("button", { name: "Anmeldung prüfen" }));

  expect((await dialog.findByRole("alert")).textContent).toBe(message);
});

/** Opens Testnotizen's Connect dialog from Verfügbar. */
async function openTestnotizenDialog(user: ReturnType<typeof userEvent.setup>) {
  const available = within(
    await screen.findByRole("region", { name: "Verfügbar" }),
  );
  const row = available.getByText("Testnotizen").closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Verbinden" }));
  return within(
    await screen.findByRole("dialog", { name: "Testnotizen verbinden" }),
  );
}

test("connects an OAuth Integration: shows its tools by class and the data note, then sends the student to the vendor", async () => {
  const vendor =
    "https://mcp.nunio.test/authorize?client_id=x&state=s&code_challenge=c";
  let started = 0;
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [email, testnotizen] }),
  );
  api.route("POST", "/api/me/connections/testnotizen/oauth", () => {
    started++;
    return Response.json({ authorizationUrl: vendor });
  });
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openTestnotizenDialog(user);

  expect(
    dialog.getByText("Notizen durchsuchen und lesen, Seiten anlegen"),
  ).toBeTruthy();
  const listed = (name: string) =>
    within(dialog.getByRole("region", { name }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
  expect(listed("Liest")).toEqual(["Notiz lesen", "Notizen durchsuchen"]);
  expect(listed("Schreibt nach deiner Freigabe")).toEqual(["Seite anlegen"]);
  expect(listed("Fragt immer vorher")).toEqual(["Notiz teilen"]);
  expect(
    dialog.getByText("Test-Dienst, Daten bleiben auf deinem Rechner."),
  ).toBeTruthy();
  expect(
    dialog.getByText(
      "Was nunio liest, geht ohne Speicherung beim Anbieter an das KI-Modell.",
    ),
  ).toBeTruthy();
  expect(
    dialog.getByText(
      "nunio speichert es verschlüsselt, bis du den Chat löschst oder die Verbindung trennst.",
    ),
  ).toBeTruthy();

  await user.click(
    dialog.getByRole("button", { name: "Mit Testnotizen verbinden" }),
  );

  await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith(vendor));
  expect(started).toBe(1);
  // On its way to the vendor, the dialog stays busy.
  expect(
    dialog
      .getByRole("button", { name: "Mit Testnotizen verbinden" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test("shows why connecting didn't start, and stays on nunio", async () => {
  api.route("GET", "/api/me/integrations", () =>
    Response.json({ integrations: [testnotizen] }),
  );
  api.route("POST", "/api/me/connections/testnotizen/oauth", () =>
    Response.json({ error: "issuer_refused" }, { status: 422 }),
  );
  const user = userEvent.setup();
  renderConnections();

  const dialog = await openTestnotizenDialog(user);
  await user.click(
    dialog.getByRole("button", { name: "Mit Testnotizen verbinden" }),
  );

  expect((await dialog.findByRole("alert")).textContent).toBe(
    "nunio konnte die Anmeldung bei Testnotizen nicht starten. Bitte versuche es später erneut.",
  );
  expect(leaveTo).not.toHaveBeenCalled();
  expect(
    dialog
      .getByRole("button", { name: "Mit Testnotizen verbinden" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

test.each([
  [
    "cancelled",
    "Du hast die Anmeldung bei Testnotizen abgebrochen. Es wurde nichts gespeichert.",
  ],
  [
    "expired",
    "Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster begonnen. Versuch es noch einmal.",
  ],
  [
    "failed",
    "Die Anmeldung bei Testnotizen hat nicht geklappt. Es wurde nichts gespeichert.",
  ],
  ["already_connected", "Du hast Testnotizen schon verbunden."],
])(
  "reopens the Connect dialog with the reason after coming back %s from the vendor",
  async (error, message) => {
    api.route("GET", "/api/me/integrations", () =>
      Response.json({ integrations: [email, testnotizen] }),
    );
    window.history.replaceState(
      null,
      "",
      `/settings/connections?connect=testnotizen&error=${error}`,
    );
    const user = userEvent.setup();
    renderConnections({ integrationKey: "testnotizen", error });

    const dialog = within(
      await screen.findByRole("dialog", { name: "Testnotizen verbinden" }),
    );
    expect(dialog.getByRole("alert").textContent).toBe(message);

    await user.click(dialog.getByRole("button", { name: "Abbrechen" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // A reload doesn't show the reason again.
    expect(window.location.search).toBe("");
  },
);
