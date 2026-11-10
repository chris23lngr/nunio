import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { PushSettings } from "@/features/inbox/push-settings";
import { api } from "./api";
import { TestProviders } from "./providers";

const subscription = {
  endpoint: "https://push.example.test/send/abc",
  expirationTime: null,
  keys: { p256dh: "BNcR-test-key", auth: "test-auth" },
};

/** Gives jsdom the browser's push APIs, with the student answering the permission prompt with `answer`. */
function browserWithPush(answer: NotificationPermission) {
  const subscribe = vi.fn(async () => ({
    toJSON: () => subscription,
    unsubscribe: async () => true,
  }));
  const registration = {
    pushManager: { subscribe, getSubscription: async () => null },
  };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn(async () => answer),
  });
  const register = vi.fn(async (_url: string) => registration);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register,
      ready: Promise.resolve(registration),
      getRegistration: async () => undefined,
    },
  });
  return { subscribe, register };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

test("allowing notifications subscribes this device with nunio's key", async () => {
  const { subscribe, register } = browserWithPush("granted");
  const saved: unknown[] = [];
  api.route("GET", "/api/me/push-key", () =>
    Response.json({ publicKey: "BPublicKey" }),
  );
  api.route("POST", "/api/me/push-subscriptions", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  render(
    <TestProviders>
      <PushSettings apiOrigin={api.origin} />
    </TestProviders>,
  );

  await userEvent.click(
    await screen.findByRole("button", {
      name: "Turn on notifications on this device",
    }),
  );

  expect(
    await screen.findByText("Notifications are on for this device."),
  ).toBeTruthy();
  expect(subscribe).toHaveBeenCalledWith(
    expect.objectContaining({ userVisibleOnly: true }),
  );
  expect(saved).toEqual([subscription]);
  // The service worker renews a replaced subscription itself, so it must know where the API is.
  expect(register).toHaveBeenCalledWith(
    `/sw.js?api=${encodeURIComponent(api.origin)}`,
  );
});

test("denying notifications sends nothing, says why, and leaves the Inbox usable", async () => {
  browserWithPush("denied");
  const closings: unknown[] = [];
  const intervention = {
    id: "5c1e0a4e-0000-4000-8000-000000000001",
    kind: "shortfall",
    title: "Problem sheet 3",
    course: "Analysis I",
    action: null,
    shortMinutes: 600,
    raisedAt: "2026-11-10T07:00:00.000Z",
    state: "open",
    closedAt: null,
  };
  api.route("GET", "/api/me/inbox", () =>
    Response.json({
      interventions: [
        { ...intervention, state: closings.length ? "acknowledged" : "open" },
      ],
      briefings: [],
    }),
  );
  api.route(
    "POST",
    `/api/me/interventions/${intervention.id}`,
    async (request) => {
      closings.push(await request.json());
      return Response.json({ status: "ok" });
    },
  );
  render(
    <TestProviders>
      <InboxScreen apiOrigin={api.origin} />
      <PushSettings apiOrigin={api.origin} />
    </TestProviders>,
  );

  await userEvent.click(
    await screen.findByRole("button", {
      name: "Turn on notifications on this device",
    }),
  );

  expect(
    await screen.findByText(/Notifications are blocked for nunio/),
  ).toBeTruthy();
  const item = screen.getByRole("article", {
    name: "10 h short for Problem sheet 3",
  });
  await userEvent.click(within(item).getByRole("button", { name: "Got it" }));
  expect(closings).toEqual([{ as: "acknowledged" }]);
  expect(await screen.findByText("Acknowledged")).toBeTruthy();
});

test("a browser without push says how to get notifications on an iPhone", async () => {
  render(
    <TestProviders>
      <PushSettings apiOrigin={api.origin} />
    </TestProviders>,
  );

  expect(await screen.findByText(/add nunio to your Home Screen/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
