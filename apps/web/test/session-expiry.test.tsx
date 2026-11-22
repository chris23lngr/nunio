import { useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { Providers } from "@/app/providers";
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
