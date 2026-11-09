import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getSession } from "@/lib/session";

const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: vi.fn() }));
vi.mock("next/headers", () => ({ headers: requestHeaders }));

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", "http://localhost:3001");
  requestHeaders.mockResolvedValue(new Headers());
});
afterEach(() => vi.unstubAllEnvs());

test("unrelated cookies do not trigger a session lookup", async () => {
  requestHeaders.mockResolvedValue(new Headers({ cookie: "auth-preview=1" }));
  const fetchSession = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
  expect(await getSession()).toBeNull();
  expect(fetchSession).not.toHaveBeenCalled();
});

test("an unavailable session API returns no session instead of crashing the page", async () => {
  requestHeaders.mockResolvedValue(new Headers({ cookie: "better-auth.session_token=preview" }));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
  expect(await getSession()).toBeNull();
});

test.each(["better-auth.session_token", "__Secure-better-auth.session_token"])("%s still requires a verified server response", async name => {
  const cookie = `${name}=preview; preference=1`;
  requestHeaders.mockResolvedValue(new Headers({ cookie }));
  const session = { session: { id: "session" }, user: { id: "user", name: "Student", email: "student@example.com", emailVerified: true } };
  const fetchSession = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(session));
  expect(await getSession()).toEqual(session);
  expect(fetchSession).toHaveBeenCalledWith("http://localhost:3001/api/auth/get-session", { headers: { cookie }, cache: "no-store" });
  fetchSession.mockResolvedValueOnce(Response.json({ ...session, user: { ...session.user, emailVerified: false } }));
  expect(await getSession()).toBeNull();
});
