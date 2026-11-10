import {
  render as renderComponent,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppLayout from "@/app/(app)/layout";
import { api } from "./api";
import { TestProviders } from "./providers";

function render(element: ReactElement) {
  return renderComponent(<TestProviders>{element}</TestProviders>);
}

const { route } = vi.hoisted(() => ({ route: { pathname: "/" } }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  route.pathname = "/";
  vi.stubEnv("API_ORIGIN", api.origin);
  api.route("GET", "/api/auth/get-session", () => Response.json(null));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("each navigation link has its own decorative icon", () => {
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  expect(screen.queryByRole("link", { name: "Account" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "Einstellungen" }).getAttribute("href"),
  ).toBe("/settings/security");

  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(9);
  const glyphs = links.map((link) => {
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    return icon!.innerHTML;
  });
  expect(new Set(glyphs).size).toBe(9);
});

test.each([
  ["/", "Home"],
  ["/inbox", "Inbox"],
  ["/review", "Review"],
  ["/chat", "Chat"],
  ["/plan", "Plan"],
  ["/study", "Study"],
  ["/study/artifacts/a-1", "Study"],
  ["/projects", "Projects"],
  ["/responsibilities", "Responsibilities"],
  ["/projects/project-1", "Projects"],
  ["/responsibilities/r-1", "Responsibilities"],
])("%s selects only %s in app navigation", (pathname, title) => {
  route.pathname = pathname;
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const navigation = within(
    screen.getByRole("navigation", { name: "App navigation" }),
  );
  expect(navigation.getByRole("link", { current: "page" }).textContent).toBe(
    title,
  );
  for (const link of navigation.getAllByRole("link")) {
    expect(link.hasAttribute("data-active")).toBe(link.textContent === title);
  }
});

test("a shared URL prefix does not select another section", () => {
  route.pathname = "/projects-archive";
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  expect(screen.queryByRole("link", { current: "page" })).toBeNull();
});

test("the layout trigger and keyboard shortcut toggle the sidebar together", async () => {
  const user = userEvent.setup();
  render(
    <AppLayout>
      <main>Page content</main>
    </AppLayout>,
  );

  const navigation = screen.getByRole("navigation", { name: "App navigation" });
  const sidebar = navigation.closest('[data-slot="sidebar"]')!;
  expect(sidebar.getAttribute("data-state")).toBe("expanded");

  expect(screen.queryByRole("button", { name: "Sidebar öffnen" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Sidebar schließen" }));
  expect(sidebar.getAttribute("data-state")).toBe("collapsed");

  await user.click(screen.getByRole("button", { name: "Sidebar öffnen" }));
  expect(sidebar.getAttribute("data-state")).toBe("expanded");
  expect(screen.queryByRole("button", { name: "Sidebar öffnen" })).toBeNull();

  await user.keyboard("{Control>}b{/Control}");
  expect(sidebar.getAttribute("data-state")).toBe("collapsed");
  await user.keyboard("{Control>}b{/Control}");
  expect(sidebar.getAttribute("data-state")).toBe("expanded");
  expect(screen.getByRole("main").textContent).toBe("Page content");
});
