import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AppSidebar } from "@/features/shared/components/app-sidebar";
import { createQueryClient } from "@/lib/query-client";
import { api } from "./api";

const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => router,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  api.route("GET", "/api/auth/get-session", () =>
    Response.json({
      session: {
        id: "sidebar-session",
        token: "sidebar-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      user: {
        id: "student",
        name: "Justus Schuhmacher",
        email: "justus@example.com",
        emailVerified: true,
      },
    }),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: ["2026-ws"], courses: [] }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderSidebar(client = createQueryClient(() => {})) {
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <AppSidebar apiOrigin={api.origin} />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

test("the student can retry an unavailable session instead of seeing an endless loading state", async () => {
  const user = userEvent.setup();
  api.route("GET", "/api/auth/get-session", () =>
    Response.json({ message: "Unavailable" }, { status: 503 }),
  );
  renderSidebar();
  const retry = await screen.findByRole("button", {
    name: "Benutzermenü erneut laden",
  });
  api.route("GET", "/api/auth/get-session", () =>
    Response.json({
      session: {
        id: "sidebar-session",
        token: "sidebar-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      user: {
        id: "student",
        name: "Justus Schuhmacher",
        email: "justus@example.com",
        emailVerified: true,
      },
    }),
  );
  await user.click(retry);
  expect(
    await screen.findByRole("button", { name: "Justus Schuhmacher" }),
  ).toBeTruthy();
});

test("the student opens their user menu and dismisses it with Escape", async () => {
  const user = userEvent.setup();
  renderSidebar();
  const trigger = await screen.findByRole("button", {
    name: "Justus Schuhmacher",
  });
  expect(within(trigger).getByText("JS")).toBeTruthy();
  await user.click(trigger);
  const menu = within(await screen.findByRole("menu"));
  expect(menu.getByText("justus@example.com")).toBeTruthy();
  expect(
    menu.getByRole("menuitem", { name: "Einstellungen" }).getAttribute("href"),
  ).toBe("/settings/security");
  expect(menu.getByRole("menuitem", { name: "Nutzung" })).toBeTruthy();
  expect(
    menu.getByRole("menuitem", { name: "Upgrade durchführen" }),
  ).toBeTruthy();
  expect(menu.getByRole("menuitem", { name: "Abmelden" })).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("signing out clears private cached data and returns the student to sign-in", async () => {
  const user = userEvent.setup();
  let signedOut = false;
  api.route("POST", "/api/auth/sign-out", () => {
    signedOut = true;
    return Response.json({ success: true });
  });
  const client = createQueryClient(() => {});
  client.setQueryData(["private-study-data"], "Only visible to this student");
  renderSidebar(client);
  await user.click(
    await screen.findByRole("button", { name: "Justus Schuhmacher" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Abmelden" }));
  await vi.waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/sign-in"),
  );
  expect(signedOut).toBe(true);
  expect(client.getQueryData(["private-study-data"])).toBeUndefined();
  expect(router.refresh).toHaveBeenCalled();
});

test("a failed sign-out stays visible and can be retried", async () => {
  const user = userEvent.setup();
  let fail = true;
  api.route("POST", "/api/auth/sign-out", () =>
    fail
      ? Response.json({ message: "Unavailable" }, { status: 503 })
      : Response.json({ success: true }),
  );
  renderSidebar();
  await user.click(
    await screen.findByRole("button", { name: "Justus Schuhmacher" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Abmelden" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.",
  );
  expect(router.replace).not.toHaveBeenCalled();
  fail = false;
  await user.click(screen.getByRole("menuitem", { name: "Abmelden" }));
  await vi.waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/sign-in"),
  );
});
