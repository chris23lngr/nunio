import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PageHeader } from "./page-header";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderHeader(header: React.ReactNode, { sidebarOpen = true } = {}) {
  return render(
    <SidebarProvider defaultOpen={sidebarOpen}>{header}</SidebarProvider>,
  );
}

test("the header is a banner landmark showing its content in order", () => {
  renderHeader(
    <PageHeader>
      <button type="button">Modell wählen</button>
      <button type="button">Teilen</button>
    </PageHeader>,
  );

  const header = screen.getByRole("banner");
  const labels = Array.from(header.querySelectorAll("button")).map(
    (button) => button.textContent,
  );
  expect(labels).toEqual(["Modell wählen", "Teilen"]);
});

test("the header has no title", () => {
  renderHeader(
    <PageHeader>
      <button type="button">Modell wählen</button>
    </PageHeader>,
  );

  expect(screen.queryByRole("heading")).toBeNull();
});

test("the header leads with a sidebar-open button while the sidebar is closed", () => {
  renderHeader(
    <PageHeader>
      <button type="button">Modell wählen</button>
    </PageHeader>,
    { sidebarOpen: false },
  );

  const buttons = screen.getByRole("banner").querySelectorAll("button");
  expect(buttons[0]?.getAttribute("aria-label")).toBe("Sidebar öffnen");
  expect(buttons[1]?.textContent).toBe("Modell wählen");
});

test("a consumer can add classes without losing the header's own", () => {
  renderHeader(<PageHeader className="custom-class" />);

  const classes = screen.getByRole("banner").className.split(" ");
  expect(classes).toContain("custom-class");
  expect(classes).toContain("h-16");
});
