import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ConnectionsScreen } from "@/features/settings/connections-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const email = {
  key: "email",
  name: "E-Mail",
  logo: "/integrations/email.svg",
  description:
    "Mails deiner Uni-Adresse durchsuchen und lesen, nach deiner Freigabe senden",
  dataNote: "Daten werden von deiner Hochschule verarbeitet",
  connection: null,
};
const testnotizen = {
  key: "testnotizen",
  name: "Testnotizen",
  logo: "/integrations/testnotizen.svg",
  description: "Notizen durchsuchen und lesen, Seiten anlegen",
  dataNote: "Test-Dienst, Daten bleiben auf deinem Rechner",
  connection: null,
};

function renderConnections() {
  return render(
    <TestProviders>
      <ConnectionsScreen apiOrigin={api.origin} />
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
