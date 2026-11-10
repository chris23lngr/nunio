import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { NotificationsScreen } from "@/features/settings/notifications-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const initial = {
  email: true,
  briefingEmail: true,
  briefingAtMinute: 420,
  quietHours: { fromMinute: 1320, toMinute: 420 } as {
    fromMinute: number;
    toMinute: number;
  } | null,
  dailyLimit: 3,
};

function serveSettings() {
  let settings = { ...initial };
  const patches: unknown[] = [];
  api.route("GET", "/api/me/outreach-settings", () => Response.json(settings));
  api.route("PATCH", "/api/me/outreach-settings", async (request) => {
    const patch = await request.json();
    patches.push(patch);
    settings = { ...settings, ...patch };
    return Response.json(settings);
  });
  return patches;
}

function renderSettings() {
  return render(
    <TestProviders>
      <NotificationsScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
}

test("email changes are drafts until saved and cancel restores saved values", async () => {
  const patches = serveSettings();
  const user = userEvent.setup();
  renderSettings();
  const email = await screen.findByRole("checkbox", { name: "E-Mail" });
  const group = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  const briefing = group.getByRole("checkbox", {
    name: "Tägliches Briefing auch per E-Mail erhalten",
  });
  await user.click(email);
  expect(briefing.getAttribute("aria-disabled")).toBe("true");
  expect(patches).toEqual([]);
  await user.click(group.getByRole("button", { name: "Abbrechen" }));
  expect(email.getAttribute("aria-checked")).toBe("true");
  await user.click(briefing);
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(patches).toEqual([{ email: true, briefingEmail: false }]),
  );
  await waitFor(() =>
    expect(group.getByRole("button", { name: "Speichern" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
});

test("quiet hours and the daily limit save independently of channel drafts", async () => {
  const patches = serveSettings();
  const user = userEvent.setup();
  renderSettings();
  await user.click(await screen.findByRole("checkbox", { name: "E-Mail" }));
  const group = within(screen.getByRole("region", { name: "Ruhezeiten" }));
  const limit = group.getByRole("spinbutton", {
    name: "Maximale Benachrichtigungen pro Tag",
  });
  await user.clear(limit);
  await user.type(limit, "0");
  await user.click(
    group.getByRole("switch", { name: "Ruhezeiten aktivieren" }),
  );
  expect(group.getByLabelText("Ruhezeiten von")).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(patches).toEqual([{ dailyLimit: 0, quietHours: null }]),
  );
  expect(
    screen
      .getByRole("checkbox", { name: "E-Mail" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  const channels = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  expect(channels.getByRole("button", { name: "Speichern" })).toHaveProperty(
    "disabled",
    false,
  );
  await user.click(
    group.getByRole("switch", { name: "Ruhezeiten aktivieren" }),
  );
  const until = group.getByLabelText("Ruhezeiten bis");
  await user.clear(until);
  await user.type(until, "06:00");
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(patches[1]).toEqual({
      dailyLimit: 0,
      quietHours: { fromMinute: 1320, toMinute: 360 },
    }),
  );
});

test("the daily briefing can be rescheduled and disabled in the channel card", async () => {
  const patches = serveSettings();
  const user = userEvent.setup();
  renderSettings();
  const time = await screen.findByLabelText("Tägliches Briefing um");
  const group = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  await user.clear(time);
  await user.type(time, "08:30");
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(patches[0]).toEqual({
      email: true,
      briefingEmail: true,
      briefingAtMinute: 510,
    }),
  );
  await user.click(
    group.getByRole("checkbox", { name: "Tägliches Briefing erhalten" }),
  );
  expect(time).toHaveProperty("disabled", true);
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(patches[1]).toEqual({
      email: true,
      briefingEmail: true,
      briefingAtMinute: null,
    }),
  );
});

function browserWithPush(answer: NotificationPermission) {
  let active = false;
  const subscription = {
    endpoint: "https://push.example.test/notifications",
    toJSON: () => ({
      endpoint: "https://push.example.test/notifications",
      keys: { auth: "test-auth", p256dh: "test-key" },
    }),
    unsubscribe: async () => {
      active = false;
      return true;
    },
  };
  const registration = {
    pushManager: {
      getSubscription: async () => (active ? subscription : null),
      subscribe: async () => {
        active = true;
        return subscription;
      },
    },
  };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn(async () => answer),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

test("browser push is enabled on Save and removed on a later Save", async () => {
  browserWithPush("granted");
  serveSettings();
  const subscriptions: unknown[] = [];
  const removals: unknown[] = [];
  api.route("GET", "/api/me/push-key", () =>
    Response.json({ publicKey: "BPublicKey" }),
  );
  api.route("POST", "/api/me/push-subscriptions", async (request) => {
    subscriptions.push(await request.json());
    return Response.json({ status: "ok" });
  });
  api.route("DELETE", "/api/me/push-subscriptions", async (request) => {
    removals.push(await request.json());
    return Response.json({ status: "ok" });
  });
  const user = userEvent.setup();
  renderSettings();
  const push = await screen.findByRole("checkbox", {
    name: "Browser-Push-Benachrichtigungen",
  });
  await waitFor(() =>
    expect(push.getAttribute("aria-disabled")).not.toBe("true"),
  );
  const group = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  await user.click(push);
  expect(subscriptions).toEqual([]);
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(subscriptions).toEqual([
      {
        endpoint: "https://push.example.test/notifications",
        keys: { auth: "test-auth", p256dh: "test-key" },
      },
    ]),
  );
  await waitFor(() =>
    expect(group.getByRole("button", { name: "Speichern" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  await user.click(push);
  await user.click(group.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(removals).toEqual([
      { endpoint: "https://push.example.test/notifications" },
    ]),
  );
});

test("leaving prompts while either card has changes and Cancel removes the warning", async () => {
  serveSettings();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderSettings();
  const email = await screen.findByRole("checkbox", { name: "E-Mail" });
  await user.click(email);
  const leave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(true);
  const link = screen.getByRole("link", { name: "Sicherheit" });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  expect(confirm).toHaveBeenCalled();
  expect(click.defaultPrevented).toBe(true);
  await user.click(
    within(
      screen.getByRole("region", { name: "Benachrichtigungen" }),
    ).getByRole("button", { name: "Abbrechen" }),
  );
  const cleanLeave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanLeave);
  expect(cleanLeave.defaultPrevented).toBe(false);
  confirm.mockClear();
  const quiet = within(screen.getByRole("region", { name: "Ruhezeiten" }));
  await user.click(quiet.getByRole("switch"));
  const quietLeave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(quietLeave);
  expect(quietLeave.defaultPrevented).toBe(true);
  await user.click(quiet.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(quiet.getByRole("button", { name: "Speichern" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  await waitFor(() => {
    const savedLeave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(savedLeave);
    expect(savedLeave.defaultPrevented).toBe(false);
  });
});

test("a failed save retains the draft for retry and Cancel restores saved quiet hours", async () => {
  serveSettings();
  let failing = true;
  let saved: unknown;
  api.route("PATCH", "/api/me/outreach-settings", async (request) => {
    const patch = await request.json();
    if (failing) return Response.json({}, { status: 500 });
    saved = patch;
    return Response.json({ ...initial, ...patch });
  });
  const user = userEvent.setup();
  renderSettings();
  await user.click(await screen.findByRole("checkbox", { name: "E-Mail" }));
  const channels = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  await user.click(channels.getByRole("button", { name: "Speichern" }));
  expect(await channels.findByRole("alert")).toHaveProperty(
    "textContent",
    "Die Einstellungen konnten nicht gespeichert werden. Bitte versuche es erneut.",
  );
  expect(
    channels
      .getByRole("checkbox", { name: "E-Mail" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  failing = false;
  await user.click(channels.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(saved).toEqual({ email: false, briefingEmail: true }),
  );
  await waitFor(() => expect(channels.queryByRole("alert")).toBeNull());
  const quiet = within(screen.getByRole("region", { name: "Ruhezeiten" }));
  await user.click(quiet.getByRole("switch"));
  await user.clear(quiet.getByRole("spinbutton"));
  await user.type(quiet.getByRole("spinbutton"), "50");
  await user.click(quiet.getByRole("button", { name: "Abbrechen" }));
  expect(quiet.getByRole("spinbutton")).toHaveProperty("value", "3");
  expect(quiet.getByRole("switch").getAttribute("aria-checked")).toBe("true");
});

test("loading failures can be retried without showing editable empty settings", async () => {
  let failing = true;
  api.route("GET", "/api/me/outreach-settings", () =>
    failing ? Response.json({}, { status: 500 }) : Response.json(initial),
  );
  const user = userEvent.setup();
  renderSettings();
  expect(screen.getByRole("status").textContent).toContain("geladen");
  expect(
    await screen.findByRole("alert", {}, { timeout: 10000 }),
  ).toHaveProperty(
    "textContent",
    "Die Einstellungen konnten nicht geladen werden.",
  );
  expect(screen.queryByRole("checkbox", { name: "E-Mail" })).toBeNull();
  failing = false;
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  expect(await screen.findByRole("checkbox", { name: "E-Mail" })).toBeTruthy();
});

test("settings navigation marks Notifications as the current page", async () => {
  serveSettings();
  renderSettings();
  const navigation = within(
    screen.getByRole("navigation", { name: "Einstellungen" }),
  );
  expect(
    navigation
      .getByRole("link", { name: "Benachrichtigungen", current: "page" })
      .getAttribute("href"),
  ).toBe("/settings/notifications");
  expect(
    navigation
      .getByRole("link", { name: "Sicherheit" })
      .hasAttribute("aria-current"),
  ).toBe(false);
  await screen.findByRole("checkbox", { name: "E-Mail" });
});

test("browser Back can be cancelled while settings have unsaved changes", async () => {
  serveSettings();
  const navigation = new EventTarget();
  vi.stubGlobal("navigation", navigation);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderSettings();
  await user.click(await screen.findByRole("checkbox", { name: "E-Mail" }));
  const back = new Event("navigate", { cancelable: true });
  Object.assign(back, { navigationType: "traverse" });
  navigation.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true);
  const leave = new Event("navigate", { cancelable: true });
  Object.assign(leave, { navigationType: "traverse" });
  navigation.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(false);
});

test("denied push permission explains the block and Cancel clears the draft", async () => {
  browserWithPush("denied");
  const patches = serveSettings();
  const user = userEvent.setup();
  renderSettings();
  const push = await screen.findByRole("checkbox", {
    name: "Browser-Push-Benachrichtigungen",
  });
  await waitFor(() =>
    expect(push.getAttribute("aria-disabled")).not.toBe("true"),
  );
  const group = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  await user.click(push);
  await user.click(group.getByRole("button", { name: "Speichern" }));
  expect(await group.findByRole("alert")).toHaveProperty(
    "textContent",
    "Benachrichtigungen sind in diesem Browser blockiert. Erlaube sie in den Website-Einstellungen deines Browsers.",
  );
  expect(patches).toEqual([]);
  await user.click(group.getByRole("button", { name: "Abbrechen" }));
  expect(push.getAttribute("aria-checked")).toBe("false");
  expect(group.getByRole("button", { name: "Speichern" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("unsupported browsers explain push availability and allow other settings", async () => {
  serveSettings();
  renderSettings();
  const push = await screen.findByRole("checkbox", {
    name: "Browser-Push-Benachrichtigungen",
  });
  expect(push.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText(/Auf iPhone oder iPad/)).toBeTruthy();
  expect(
    screen
      .getByRole("checkbox", { name: "E-Mail" })
      .getAttribute("aria-disabled"),
  ).not.toBe("true");
});

test("a pending channel save prevents duplicate submits and edits", async () => {
  serveSettings();
  let requests = 0;
  let finish!: () => void;
  api.route("PATCH", "/api/me/outreach-settings", () => {
    requests++;
    return new Promise<Response>((resolve) => {
      finish = () => resolve(Response.json({ ...initial, email: false }));
    });
  });
  const user = userEvent.setup();
  renderSettings();
  const email = await screen.findByRole("checkbox", { name: "E-Mail" });
  await user.click(email);
  const channels = within(
    screen.getByRole("region", { name: "Benachrichtigungen" }),
  );
  const save = channels.getByRole("button", { name: "Speichern" });
  await user.click(save);
  await waitFor(() => expect(requests).toBe(1));
  await user.click(email);
  await user.click(save);
  expect(email.getAttribute("aria-checked")).toBe("false");
  expect(requests).toBe(1);
  finish();
  await waitFor(() => expect(save).toHaveProperty("disabled", true));
});
