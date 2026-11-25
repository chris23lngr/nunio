import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SecurityScreen } from "@/features/settings/security-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  Reflect.deleteProperty(window, "PublicKeyCredential");
  Reflect.deleteProperty(navigator, "credentials");
});

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

const passkey = {
  id: "passkey-1",
  name: "MacBook – Safari",
  userId: "student-1",
  credentialID: "credential-1",
  publicKey: "key",
  counter: 1,
  deviceType: "multiDevice",
  backedUp: true,
  transports: "internal",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastUsedAt: "2026-11-20T09:00:00.000Z",
};

function servePasskeys(passkeys: unknown[] = []) {
  api.route("GET", "/api/auth/passkey/list-user-passkeys", () =>
    Response.json(passkeys),
  );
}

function serveSessions(sessions = [currentSession]) {
  servePasskeys();
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

test("security settings show real sessions and the settings destinations", async () => {
  serveSessions();
  renderSettings();

  expect(
    screen.getByRole("heading", { name: "Einstellungen", level: 1 }),
  ).toBeTruthy();
  const navigation = within(
    screen.getByRole("navigation", { name: "Einstellungen" }),
  );
  expect(navigation.getAllByRole("link")).toHaveLength(3);
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

/** Answers a sign-in code request and its entry, as the API does for a recent sign-in. */
/** A browser with a passkey for this student, and the API that checks it. */
function supportPasskeySignIn() {
  const buffer = () => new Uint8Array([1, 2, 3]).buffer;
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: {
      get: async () => ({
        id: "credential-1",
        rawId: buffer(),
        type: "public-key",
        authenticatorAttachment: "platform",
        getClientExtensionResults: () => ({}),
        response: {
          authenticatorData: buffer(),
          clientDataJSON: buffer(),
          signature: buffer(),
          userHandle: null,
        },
      }),
    },
  });
  const browser = { verified: 0 };
  api.route("GET", "/api/auth/passkey/generate-authenticate-options", () =>
    Response.json({ challenge: "Y2hhbGxlbmdl", userVerification: "required" }),
  );
  api.route("POST", "/api/auth/passkey/verify-authentication", () => {
    browser.verified++;
    return Response.json({
      session: currentSession,
      user: { id: "student-1" },
    });
  });
  return browser;
}

function serveCodeSignIn() {
  const requested: string[] = [];
  const entered: string[] = [];
  api.route(
    "POST",
    "/api/auth/email-otp/send-verification-otp",
    async (request) => {
      requested.push(((await request.json()) as { email: string }).email);
      return Response.json({ success: true });
    },
  );
  api.route("POST", "/api/auth/sign-in/email-otp", async (request) => {
    entered.push(((await request.json()) as { otp: string }).otp);
    return Response.json({
      token: "fresh-token",
      user: {
        id: "student-1",
        name: "Justus",
        email: "justus@example.com",
        emailVerified: true,
        createdAt: currentSession.createdAt,
        updatedAt: currentSession.updatedAt,
      },
    });
  });
  return { requested, entered };
}

test("deletion asks for confirmation and requests it from a recent sign-in", async () => {
  serveSessions();
  let requests = 0;
  api.route("POST", "/api/me/deletion-request", () => {
    requests++;
    return Response.json({ status: "pending" }, { status: 202 });
  });
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(
    await screen.findByRole("dialog", { name: "Konto löschen?" }),
  );
  expect(dialog.getByText(/manuellen Löschung/)).toBeTruthy();
  expect(dialog.getByText(/allen Geräten abgemeldet/)).toBeTruthy();
  expect(dialog.queryByLabelText(/Passwort/)).toBeNull();
  await user.click(dialog.getByRole("button", { name: "Löschung anfordern" }));

  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/sign-in?deletion=requested"),
  );
  expect(requests).toBe(1);
  expect(router.refresh).not.toHaveBeenCalled();
});

test("deletion from an older sign-in asks for an emailed code, then requests it", async () => {
  serveSessions();
  const code = serveCodeSignIn();
  let requests = 0;
  api.route("POST", "/api/me/deletion-request", () => {
    requests++;
    return requests === 1
      ? Response.json({ error: "sign_in_again" }, { status: 403 })
      : Response.json({ status: "pending" }, { status: 202 });
  });
  const user = userEvent.setup();
  renderSettings();
  await screen.findByText("Dieses Gerät");
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Löschung anfordern" }));

  const input = await dialog.findByLabelText("Anmeldecode");
  expect(dialog.getByText(/justus@example\.com/)).toBeTruthy();
  expect(code.requested).toEqual(["justus@example.com"]);
  expect(router.replace).not.toHaveBeenCalled();
  await user.type(input, "123456");

  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/sign-in?deletion=requested"),
  );
  expect(code.entered).toEqual(["123456"]);
  expect(requests).toBe(2);
});

test("a failed deletion leaves the dialog open with actionable feedback", async () => {
  serveSessions();
  api.route("POST", "/api/me/deletion-request", () =>
    Response.json({}, { status: 500 }),
  );
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Löschung anfordern" }));
  expect(await dialog.findByRole("alert")).toHaveProperty(
    "textContent",
    "Die Löschung konnte nicht angefordert werden. Bitte versuche es erneut.",
  );
  expect(router.replace).not.toHaveBeenCalled();
});

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
  const submit = dialog.getByRole("button", { name: "Löschung anfordern" });
  await user.click(submit);
  await waitFor(() => expect(submit).toHaveProperty("disabled", true));
  await waitFor(() => expect(requests).toBe(1));
  await user.click(submit);
  expect(requests).toBe(1);
  finish();
  await dialog.findByRole("alert");
});

test("cancelling deletion sends no deletion request", async () => {
  serveSessions();
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Abbrechen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(router.replace).not.toHaveBeenCalled();
});

test("signing out everywhere from an older sign-in asks for an emailed code first", async () => {
  serveSessions();
  const code = serveCodeSignIn();
  let attempts = 0;
  api.route("POST", "/api/auth/revoke-sessions", () => {
    attempts++;
    return attempts === 1
      ? Response.json(
          { code: "SESSION_NOT_FRESH", message: "Sign in again to continue." },
          { status: 403 },
        )
      : Response.json({ status: true });
  });
  const user = userEvent.setup();
  renderSettings();
  await screen.findByText("Dieses Gerät");
  await user.click(screen.getByRole("button", { name: "Überall abmelden" }));

  const dialog = within(
    await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" }),
  );
  await user.type(await dialog.findByLabelText("Anmeldecode"), "123456");

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in"));
  expect(code.requested).toEqual(["justus@example.com"]);
  expect(attempts).toBe(2);
});

test("signing out everywhere from an older sign-in can be confirmed with a passkey", async () => {
  serveSessions();
  servePasskeys([passkey]);
  const code = serveCodeSignIn();
  const browser = supportPasskeySignIn();
  let attempts = 0;
  api.route("POST", "/api/auth/revoke-sessions", () => {
    attempts++;
    return attempts === 1
      ? Response.json(
          { code: "SESSION_NOT_FRESH", message: "Sign in again to continue." },
          { status: 403 },
        )
      : Response.json({ status: true });
  });
  const user = userEvent.setup();
  renderSettings();
  await screen.findByText("Dieses Gerät");
  await within(screen.getByRole("region", { name: "Passkeys" })).findByRole(
    "listitem",
  );
  await user.click(screen.getByRole("button", { name: "Überall abmelden" }));

  const dialog = within(
    await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" }),
  );
  await user.click(
    dialog.getByRole("button", { name: "Mit Passkey bestätigen" }),
  );

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in"));
  expect(browser.verified).toBe(1);
  expect(code.requested).toEqual([]);
  expect(attempts).toBe(2);
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

test("security settings list passkeys with when they were added and last used", async () => {
  serveSessions();
  servePasskeys([
    passkey,
    { ...passkey, id: "passkey-2", name: "iPhone – Safari", lastUsedAt: null },
  ]);
  renderSettings();

  const group = within(screen.getByRole("region", { name: "Passkeys" }));
  const rows = await group.findAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain("MacBook – Safari");
  expect(rows[0]!.textContent).toContain("Hinzugefügt am 1. Nov. 2026");
  expect(rows[0]!.textContent).toContain("Zuletzt verwendet am 20. Nov. 2026");
  expect(rows[1]!.textContent).toContain("Noch nie verwendet");
  expect(
    group.getByRole("button", { name: "Passkey hinzufügen" }),
  ).toBeTruthy();
});

test("without passkeys the settings explain what one is for", async () => {
  serveSessions();
  renderSettings();

  const group = within(screen.getByRole("region", { name: "Passkeys" }));
  expect((await group.findByText(/noch keinen Passkey/)).textContent).toContain(
    "Face ID",
  );
});

test("deleting a passkey removes it, even the last one", async () => {
  serveSessions();
  let passkeys = [passkey];
  api.route("GET", "/api/auth/passkey/list-user-passkeys", () =>
    Response.json(passkeys),
  );
  const deleted: string[] = [];
  api.route("POST", "/api/auth/passkey/delete-passkey", async (request) => {
    deleted.push(((await request.json()) as { id: string }).id);
    passkeys = [];
    return Response.json({ status: true });
  });
  const user = userEvent.setup();
  renderSettings();
  const group = within(screen.getByRole("region", { name: "Passkeys" }));
  const row = await group.findByRole("listitem");
  await user.click(
    within(row).getByRole("button", { name: "MacBook – Safari löschen" }),
  );

  await waitFor(() => expect(group.queryByRole("listitem")).toBeNull());
  expect(deleted).toEqual(["passkey-1"]);
});

test("deleting a passkey from an older sign-in asks for an emailed code first", async () => {
  serveSessions();
  servePasskeys([passkey]);
  const code = serveCodeSignIn();
  let attempts = 0;
  api.route("POST", "/api/auth/passkey/delete-passkey", () => {
    attempts++;
    return attempts === 1
      ? Response.json(
          { code: "SESSION_NOT_FRESH", message: "Sign in again to continue." },
          { status: 403 },
        )
      : Response.json({ status: true });
  });
  const user = userEvent.setup();
  renderSettings();
  await screen.findByText("Dieses Gerät");
  const row = await within(
    screen.getByRole("region", { name: "Passkeys" }),
  ).findByRole("listitem");
  await user.click(
    within(row).getByRole("button", { name: "MacBook – Safari löschen" }),
  );
  const dialog = within(
    await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" }),
  );
  await user.type(await dialog.findByLabelText("Anmeldecode"), "123456");

  await waitFor(() => expect(attempts).toBe(2));
  expect(code.requested).toEqual(["justus@example.com"]);
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Bestätige, dass du es bist" }),
    ).toBeNull(),
  );
});
