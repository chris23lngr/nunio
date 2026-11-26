import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ConnectionScreen } from "@/features/settings/connection-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const testnotizen = {
  key: "testnotizen",
  name: "Testnotizen",
  logo: "/integrations/testnotizen.svg",
  kind: "mcp",
  connection: {
    state: "connected",
    accountLabel: "Leas Lernnotizen",
    folders: [],
    agentCount: 0,
  },
  tools: [
    {
      name: "notes.create_page",
      label: "Seite anlegen",
      class: "write",
      mode: "ask",
      available: true,
    },
    {
      name: "notes.delete",
      label: "Notiz löschen",
      class: "blocked",
      mode: null,
      available: false,
    },
    {
      name: "notes.read",
      label: "Notiz lesen",
      class: "read",
      mode: null,
      available: true,
    },
    {
      name: "notes.share",
      label: "Notiz teilen",
      class: "write_always_asked",
      mode: "always_asks",
      available: true,
    },
  ],
};

const email = {
  key: "email",
  name: "E-Mail",
  logo: "/integrations/email.svg",
  kind: "email",
  connection: {
    state: "connected",
    accountLabel: "lea@uni-heidelberg.de",
    folders: ["INBOX"],
    agentCount: 0,
  },
  tools: [
    {
      name: "email.read",
      label: "Mail lesen",
      class: "read",
      mode: null,
      available: true,
    },
    {
      name: "email.send",
      label: "Mail senden",
      class: "write_always_asked",
      mode: "always_asks",
      available: true,
    },
  ],
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

function renderConnection(integrationKey: string) {
  return render(
    <TestProviders>
      <ConnectionScreen
        apiOrigin={api.origin}
        integrationKey={integrationKey}
      />
    </TestProviders>,
  );
}

test("shows the Connection's header and its tools grouped by class, with Nachfragen / Immer erlaubt only for grantable writes", async () => {
  api.route("GET", "/api/me/connections/testnotizen", () =>
    Response.json(testnotizen),
  );
  renderConnection("testnotizen");

  const region = await screen.findByRole("region", { name: "Testnotizen" });
  const header = within(region);
  expect(header.getByText("Leas Lernnotizen")).toBeTruthy();
  expect(header.getByText("Verbunden")).toBeTruthy();
  expect(region.querySelector("img")?.getAttribute("src")).toBe(
    "/integrations/testnotizen.svg",
  );

  const reading = within(screen.getByRole("region", { name: "Lesen" }));
  expect(reading.getByText("Notiz lesen")).toBeTruthy();
  expect(reading.queryByRole("combobox")).toBeNull();

  const writing = within(screen.getByRole("region", { name: "Schreiben" }));
  expect(writing.getByText("Seite anlegen")).toBeTruthy();
  const mode = writing.getByRole("combobox", { name: "Seite anlegen" });
  expect(mode.textContent).toContain("Nachfragen");

  const alwaysAsked = within(
    screen.getByRole("region", { name: "Fragt immer" }),
  );
  const share = within(alwaysAsked.getByRole("listitem"));
  expect(share.getByText("Notiz teilen")).toBeTruthy();
  expect(share.getByText("Fragt immer")).toBeTruthy();
  expect(share.queryByRole("combobox")).toBeNull();

  const blocked = within(
    screen.getByRole("region", { name: "Nicht verfügbar" }),
  );
  const remove = within(blocked.getByRole("listitem"));
  expect(remove.getByText("Notiz löschen")).toBeTruthy();
  expect(remove.queryByRole("combobox")).toBeNull();

  // Email's folders belong to Email only.
  expect(
    screen.queryByRole("region", { name: "Ordner, die nunio lesen darf" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Verbindungen", current: "page" })
      .getAttribute("href"),
  ).toBe("/settings/connections");
});

test("makes a write tool Immer erlaubt, and Nachfragen again", async () => {
  const user = userEvent.setup();
  let current = testnotizen;
  const sent: unknown[] = [];
  api.route("GET", "/api/me/connections/testnotizen", () =>
    Response.json(current),
  );
  api.route(
    "PUT",
    "/api/me/connections/testnotizen/tools/notes.create_page",
    async (request) => {
      const { mode } = (await request.json()) as { mode: string };
      sent.push(mode);
      current = {
        ...current,
        tools: current.tools.map((tool) =>
          tool.name === "notes.create_page" ? { ...tool, mode } : tool,
        ),
      };
      return Response.json({ status: "ok" });
    },
  );
  renderConnection("testnotizen");

  const mode = await screen.findByRole("combobox", { name: "Seite anlegen" });
  await user.click(mode);
  await user.click(
    await screen.findByRole("option", { name: "Immer erlaubt" }),
  );

  await waitFor(() => expect(sent).toEqual(["always_allowed"]));
  await waitFor(() => expect(mode.textContent).toContain("Immer erlaubt"));

  await user.click(mode);
  await user.click(await screen.findByRole("option", { name: "Nachfragen" }));

  await waitFor(() => expect(sent).toEqual(["always_allowed", "ask"]));
  await waitFor(() => expect(mode.textContent).toContain("Nachfragen"));
});

test("changes Email's folders with its chips, without signing in again", async () => {
  const user = userEvent.setup();
  let current = email;
  const sent: unknown[] = [];
  api.route("GET", "/api/me/connections/email", () => Response.json(current));
  api.route("GET", "/api/me/connections/email/folders", () =>
    Response.json({ folders }),
  );
  api.route("PUT", "/api/me/connections/email/folders", async (request) => {
    const body = (await request.json()) as { folders: string[] };
    sent.push(body);
    current = {
      ...current,
      connection: { ...current.connection, folders: body.folders },
    };
    return Response.json({ status: "ok" });
  });
  renderConnection("email");

  const group = within(
    await screen.findByRole("region", { name: "Ordner, die nunio lesen darf" }),
  );
  const inbox = await group.findByRole("button", { name: "Posteingang" });
  expect(inbox.getAttribute("aria-pressed")).toBe("true");
  const lehrstuhl = group.getByRole("button", { name: "Lehrstuhl" });
  expect(lehrstuhl.getAttribute("aria-pressed")).toBe("false");
  const save = group.getByRole("button", { name: "Speichern" });
  expect(save.hasAttribute("disabled")).toBe(true);

  await user.click(lehrstuhl);
  await user.click(save);

  await waitFor(() =>
    expect(sent).toEqual([{ folders: ["INBOX", "Lehrstuhl"] }]),
  );
  await waitFor(() => expect(save.hasAttribute("disabled")).toBe(true));
  expect(lehrstuhl.getAttribute("aria-pressed")).toBe("true");

  // No folder at all can't be saved.
  await user.click(inbox);
  await user.click(lehrstuhl);
  expect(save.hasAttribute("disabled")).toBe(true);
});

test("says so when the mailbox's folders can't be listed, and keeps showing what nunio reads", async () => {
  api.route("GET", "/api/me/connections/email", () => Response.json(email));
  api.route("GET", "/api/me/connections/email/folders", () =>
    Response.json({ error: "login_failed", step: "imap" }, { status: 422 }),
  );
  renderConnection("email");

  const group = within(
    await screen.findByRole("region", { name: "Ordner, die nunio lesen darf" }),
  );
  expect((await group.findByRole("alert")).textContent).toBe(
    "nunio kann sich nicht mehr bei deinem Postfach anmelden.",
  );
  expect(group.getByText("Lesen: Posteingang")).toBeTruthy();
  expect(group.queryByRole("button", { name: "Speichern" })).toBeNull();
});

test("says so when the student has no such Connection", async () => {
  api.route("GET", "/api/me/connections/testnotizen", () =>
    Response.json({ error: "gone" }, { status: 404 }),
  );
  renderConnection("testnotizen");

  expect(
    await screen.findByText("Diese Verbindung gibt es nicht mehr."),
  ).toBeTruthy();
});
