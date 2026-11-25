import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { TestProviders } from "./providers";

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/session", () => ({
  apiOrigin: () => api.origin,
  getSession,
}));
vi.mock("next/navigation", () => ({ redirect }));

import SourcesPage from "@/app/(app)/sources/page";

beforeEach(() => {
  vi.clearAllMocks();
  api.route("GET", "/api/me/sources", () =>
    Response.json([
      {
        id: "src-1",
        title: "Syllabus.pdf",
        status: "ready",
        extraction: "done",
        failure: null,
        courseId: null,
      },
    ]),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: ["2026-ws"], courses: [] }),
  );
});

test("/sources renders SourcesScreen with full source management for a signed-in student", async () => {
  getSession.mockResolvedValue({
    user: { id: "u-1", email: "ada@example.com" },
  });

  const element = await SourcesPage();
  render(<TestProviders>{element}</TestProviders>);

  expect(
    screen.getByRole("heading", { name: "Sources", level: 1 }),
  ).toBeTruthy();
  expect(await screen.findByText(/Syllabus\.pdf/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Read again/ })).toBeTruthy();
});

test("/sources redirects signed-out visitors to /sign-in", async () => {
  getSession.mockResolvedValue(null);

  await expect(SourcesPage()).rejects.toThrow("REDIRECT:/sign-in");
  expect(redirect).toHaveBeenCalledWith("/sign-in");
});
