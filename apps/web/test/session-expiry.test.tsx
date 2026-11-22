import { useQuery } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { Providers } from "@/app/providers";
import { SecurityScreen } from "@/features/settings/security-screen";
import { apiFetch } from "@/lib/api-client";
import { api } from "./api";

const { navigation } = vi.hoisted(() => ({
  navigation: {
    pathname: "/",
    replace: vi.fn(),
    refresh: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation,
}));

let reads = 0;
let rerenderPage: () => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = "/";
  reads = 0;
  api.route("GET", "/api/me/private", () => {
    reads++;
    return Response.json({ error: "unauthorized" }, { status: 401 });
  });
  // A navigation re-renders the page it leaves until the next one lands.
  navigation.replace.mockImplementation(() => rerenderPage());
});

function PrivatePage() {
  const [, setRenders] = useState(0);
  rerenderPage = () => setRenders((n) => n + 1);
  const data = useQuery({
    queryKey: ["private"],
    queryFn: () => apiFetch(`${api.origin}/api/me/private`),
  });
  return <p>{data.status}</p>;
}

function SecurityPage() {
  const [, setRenders] = useState(0);
  rerenderPage = () => setRenders((n) => n + 1);
  return <SecurityScreen apiOrigin={api.origin} />;
}

test("an expired session leaves for sign-in once while the old page keeps reading", async () => {
  render(
    <Providers>
      <PrivatePage />
    </Providers>,
  );

  // The cleared page reads again and gets a second 401; that one must not restart the navigation.
  await vi.waitFor(() => expect(reads).toBe(2));
  await screen.findByText("error");
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenCalledWith("/sign-in");
  expect(navigation.refresh).toHaveBeenCalledTimes(1);
});

test("a session that expires again on a later page leaves for sign-in again", async () => {
  const { rerender } = render(
    <Providers>
      <PrivatePage key="first" />
    </Providers>,
  );
  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
  await screen.findByText("error");

  navigation.pathname = "/plan";
  rerender(
    <Providers>
      <PrivatePage key="later" />
    </Providers>,
  );

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(2));
});

test("account deletion leaves with its notice although the cleared page reads unauthorized", async () => {
  let deleted = false;
  const signedIn = (body: unknown) => () =>
    deleted
      ? Response.json({ error: "unauthorized" }, { status: 401 })
      : Response.json(body);
  const session = {
    id: "session-1",
    token: "current-token",
    userId: "student-1",
    createdAt: "2026-11-08T22:20:00.000Z",
    updatedAt: "2026-11-08T22:20:00.000Z",
    expiresAt: "2026-12-08T22:20:00.000Z",
  };
  api.route("GET", "/api/auth/list-sessions", signedIn([session]));
  api.route("GET", "/api/auth/passkey/list-user-passkeys", signedIn([]));
  api.route(
    "GET",
    "/api/auth/get-session",
    signedIn({
      session,
      user: {
        id: "student-1",
        name: "Justus",
        email: "justus@example.com",
        emailVerified: true,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    }),
  );
  api.route("POST", "/api/me/deletion-request", () => {
    deleted = true;
    return Response.json({ status: "pending" }, { status: 202 });
  });
  navigation.pathname = "/settings/security";
  const user = userEvent.setup();
  render(
    <Providers>
      <SecurityPage />
    </Providers>,
  );
  await screen.findByText("Dieses Gerät");
  await user.click(screen.getByRole("button", { name: "Konto löschen" }));
  const dialog = within(
    await screen.findByRole("dialog", { name: "Konto löschen?" }),
  );
  await user.click(dialog.getByRole("button", { name: "Löschung anfordern" }));

  // The cleared page reads again and gets 401s while the deletion's navigation is under way.
  await screen.findByText("Deine Sitzungen konnten nicht geladen werden.");
  expect(navigation.replace.mock.calls).toEqual([
    ["/sign-in?deletion=requested"],
  ]);
});
