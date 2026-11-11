import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SecurityScreen } from "@/features/settings/security-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const currentSession = {
  id: "session-1",
  token: "current-token",
  userId: "student-1",
  createdAt: "2026-11-08T22:20:00.000Z",
  updatedAt: "2026-11-08T22:20:00.000Z",
  expiresAt: "2026-12-08T22:20:00.000Z",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  ipAddress: "127.0.0.1",
};

function serveSessions(sessions = [currentSession]) {
  api.route("GET", "/api/auth/list-sessions", () => Response.json(sessions));
  api.route("GET", "/api/auth/get-session", () =>
    Response.json({
      session: currentSession,
      user: {
        id: "student-1",
        name: "Justus",
        email: "justus@example.com",
        emailVerified: true,
        createdAt: currentSession.createdAt,
        updatedAt: currentSession.updatedAt,
      },
    }),
  );
}

function renderSettings() {
  return render(
    <TestProviders>
      <SecurityScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
}

test("security settings show real sessions and only the available settings destination", async () => {
  serveSessions();
  renderSettings();

  expect(
    screen.getByRole("heading", { name: "Einstellungen", level: 1 }),
  ).toBeTruthy();
  const navigation = within(
    screen.getByRole("navigation", { name: "Einstellungen" }),
  );
  expect(navigation.getAllByRole("link")).toHaveLength(1);
  expect(
    navigation
      .getByRole("link", { name: "Sicherheit", current: "page" })
      .getAttribute("href"),
  ).toBe("/settings/security");
  const sessions = within(
    screen.getByRole("region", { name: "Aktive Sitzungen" }),
  );
  const row = await sessions.findByRole("listitem");
  expect(within(row).getByText("macOS")).toBeTruthy();
  expect(row.textContent).toContain("Chrome");
  expect(row.textContent).toContain("Angemeldet am");
  expect(within(row).getByText("Dieses Gerät")).toBeTruthy();
  expect(row.textContent).not.toContain("Mozilla");
});

test("signing out another device removes only that session", async () => {
  const other = { ...currentSession, id: "session-2", token: "other-token" };
  let sessions = [currentSession, other];
  serveSessions(sessions);
  api.route("GET", "/api/auth/list-sessions", () => Response.json(sessions));
  api.route("POST", "/api/auth/revoke-session", async (request) => {
    expect(await request.json()).toEqual({ token: "other-token" });
    sessions = [currentSession];
    return Response.json({ status: true });
  });
  renderSettings();
  const group = within(
    screen.getByRole("region", { name: "Aktive Sitzungen" }),
  );
  const rows = await group.findAllByRole("listitem");
  const otherRow = rows.find(
    (row) => !row.textContent?.includes("Dieses Gerät"),
  )!;
  await userEvent.click(
    within(otherRow).getByRole("button", { name: "Abmelden" }),
  );
  expect(await group.findByText("Dieses Gerät")).toBeTruthy();
  await vi.waitFor(() =>
    expect(group.getAllByRole("listitem")).toHaveLength(1),
  );
});

test("signing out this device returns to sign-in", async () => {
  serveSessions();
  let signedOut = false;
  api.route("POST", "/api/auth/sign-out", () => {
    signedOut = true;
    return Response.json({ success: true });
  });
  renderSettings();
  const row = await screen.findByRole("listitem");
  await userEvent.click(within(row).getByRole("button", { name: "Abmelden" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in"));
  expect(signedOut).toBe(true);
  expect(router.refresh).toHaveBeenCalled();
});

test("signing out everywhere ends all sessions before returning to sign-in", async () => {
  serveSessions();
  let revoked = false;
  api.route("POST", "/api/auth/revoke-sessions", () => {
    revoked = true;
    return Response.json({ status: true });
  });
  renderSettings();
  await screen.findByText("Dieses Gerät");
  await userEvent.click(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in"));
  expect(revoked).toBe(true);
});

test.each([
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "iOS",
    "Safari",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
    "Windows",
    "Firefox",
  ],
  [
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
    "Android",
    "Chrome",
  ],
  ["unrecognized-client", "Unbekanntes Gerät", null],
])(
  "sessions identify %s without exposing raw user agents",
  async (userAgent, device, browser) => {
    serveSessions([{ ...currentSession, userAgent }]);
    renderSettings();
    const row = await screen.findByRole("listitem");
    expect(within(row).getByText(device)).toBeTruthy();
    if (browser) expect(row.textContent).toContain(browser);
    expect(row.textContent).not.toContain(userAgent);
  },
);

test("sessions can be loaded again after a temporary failure", async () => {
  serveSessions();
  api.route("GET", "/api/auth/list-sessions", () =>
    Response.json({ message: "Unavailable" }, { status: 500 }),
  );
  renderSettings();
  expect(
    await screen.findByRole("alert", {}, { timeout: 4000 }),
  ).toHaveProperty(
    "textContent",
    "Deine Sitzungen konnten nicht geladen werden.",
  );
  serveSessions();
  await userEvent.click(
    screen.getByRole("button", { name: "Erneut versuchen" }),
  );
  expect(await screen.findByText("Dieses Gerät")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("deletion requires password confirmation and allows correcting a wrong password", async () => {
  serveSessions();
  const passwords: string[] = [];
  api.route("POST", "/api/me/deletion-request", async (request) => {
    const { password } = (await request.json()) as { password: string };
    passwords.push(password);
    return Response.json(
      {},
      { status: password === "correct-password" ? 202 : 403 },
    );
  });
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(
    await screen.findByRole("dialog", { name: "Konto löschen?" }),
  );
  expect(dialog.getByText(/manuellen Löschung/)).toBeTruthy();
  expect(dialog.getByText(/allen Geräten abgemeldet/)).toBeTruthy();
  const password = dialog.getByLabelText("Passwort");
  await user.type(password, "wrong-password");
  await user.click(dialog.getByRole("button", { name: "Löschung anfordern" }));
  expect(await dialog.findByRole("alert")).toHaveProperty(
    "textContent",
    "Das Passwort ist nicht korrekt.",
  );
  expect(router.replace).not.toHaveBeenCalled();
  await user.clear(password);
  await user.type(password, "correct-password");
  await user.click(dialog.getByRole("button", { name: "Löschung anfordern" }));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/sign-in?deletion=requested"),
  );
  expect(passwords).toEqual(["wrong-password", "correct-password"]);
  expect(router.refresh).not.toHaveBeenCalled();
});

test.each([
  [429, "Zu viele Versuche. Warte einen Moment und versuche es erneut."],
  [
    500,
    "Die Löschung konnte nicht angefordert werden. Bitte versuche es erneut.",
  ],
])(
  "deletion failure %s leaves the dialog open with actionable feedback",
  async (status, message) => {
    serveSessions();
    api.route("POST", "/api/me/deletion-request", () =>
      Response.json({}, { status }),
    );
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Konto löschen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Passwort"), "password");
    await user.click(
      dialog.getByRole("button", { name: "Löschung anfordern" }),
    );
    expect(await dialog.findByRole("alert")).toHaveProperty(
      "textContent",
      message,
    );
    expect(router.replace).not.toHaveBeenCalled();
  },
);

test("a pending deletion cannot be submitted twice", async () => {
  serveSessions();
  let requests = 0;
  let finish!: () => void;
  api.route("POST", "/api/me/deletion-request", () => {
    requests++;
    return new Promise<Response>((resolve) => {
      finish = () => resolve(Response.json({}, { status: 500 }));
    });
  });
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.type(dialog.getByLabelText("Passwort"), "password");
  const submit = dialog.getByRole("button", { name: "Löschung anfordern" });
  await user.click(submit);
  await waitFor(() => expect(submit).toHaveProperty("disabled", true));
  await waitFor(() => expect(requests).toBe(1));
  await user.click(submit);
  expect(requests).toBe(1);
  finish();
  await dialog.findByRole("alert");
});

test("cancelling deletion clears the password and sends no deletion request", async () => {
  serveSessions();
  const user = userEvent.setup();
  renderSettings();
  const trigger = screen.getByRole("button", {
    name: "Konto löschen",
  });
  await user.click(trigger);
  let dialog = within(await screen.findByRole("dialog"));
  await user.type(dialog.getByLabelText("Passwort"), "private-password");
  await user.click(dialog.getByRole("button", { name: "Abbrechen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(trigger);
  dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByLabelText("Passwort")).toHaveProperty("value", "");
  expect(router.replace).not.toHaveBeenCalled();
});

test.each([
  [
    "other device",
    "revoke-session",
    "Diese Sitzung konnte nicht abgemeldet werden. Bitte versuche es erneut.",
  ],
  [
    "this device",
    "sign-out",
    "Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.",
  ],
  [
    "everywhere",
    "revoke-sessions",
    "Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.",
  ],
])(
  "a failed sign-out for %s preserves sessions and allows retry",
  async (target, endpoint, message) => {
    let sessions = [
      currentSession,
      { ...currentSession, id: "session-2", token: "other-token" },
    ];
    serveSessions(sessions);
    api.route("GET", "/api/auth/list-sessions", () => Response.json(sessions));
    let failing = true;
    api.route("POST", `/api/auth/${endpoint}`, () => {
      if (failing)
        return Response.json({ message: "Unavailable" }, { status: 500 });
      sessions = [currentSession];
      return Response.json({ success: true, status: true });
    });
    const user = userEvent.setup();
    renderSettings();
    const group = within(
      screen.getByRole("region", { name: "Aktive Sitzungen" }),
    );
    const rows = await group.findAllByRole("listitem");
    const button =
      target === "everywhere"
        ? group.getByRole("button", { name: "Überall abmelden" })
        : within(rows[target === "this device" ? 0 : 1]!).getByRole("button", {
            name: "Abmelden",
          });
    await user.click(button);
    expect(await group.findByRole("alert")).toHaveProperty(
      "textContent",
      message,
    );
    expect(group.getAllByRole("listitem")).toHaveLength(2);
    expect(router.replace).not.toHaveBeenCalled();
    failing = false;
    await user.click(button);
    if (target === "other device") {
      await waitFor(() =>
        expect(group.getAllByRole("listitem")).toHaveLength(1),
      );
    } else {
      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith("/sign-in"),
      );
    }
  },
);
