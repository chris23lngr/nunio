import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SignInScreen } from "@/features/auth/sign-in-screen";
import { SignUpScreen } from "@/features/auth/sign-up-screen";

const { router, client } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  client: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    sendVerificationEmail: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: () => client }));

beforeEach(() => {
  vi.clearAllMocks();
  client.signIn.email.mockResolvedValue({ error: null });
  client.signUp.email.mockResolvedValue({ error: null });
  client.sendVerificationEmail.mockResolvedValue({ error: null });
});

async function credentials() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-Mail"), "student@example.com");
  await user.type(screen.getByLabelText("Passwort", { exact: true }), "password123");
  return user;
}

async function registration() {
  const user = await credentials();
  await user.type(screen.getByLabelText("Name"), "Student");
  await user.type(screen.getByLabelText("Passwort bestätigen"), "password123");
  return user;
}

test.each([false, true])("sign-in submits rememberMe=%s and refreshes the protected route", async rememberMe => {
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await credentials();
  if (rememberMe) await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Mit E-Mail anmelden" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.signIn.email).toHaveBeenCalledWith({ email: "student@example.com", password: "password123", rememberMe });
  expect(router.refresh).toHaveBeenCalled();
});

test("sign-in has disabled social buttons and links without performing password reset", () => {
  render(<SignInScreen apiOrigin="https://api.nunio.test" invitation="invite+token" initialNotice="Hinweis" />);
  for (const provider of ["Microsoft", "Google"]) {
    expect(screen.getByRole("button", { name: `Mit ${provider} anmelden` })).toHaveProperty("disabled", true);
  }
  expect(screen.getByRole("link", { name: "Passwort vergessen?" }).getAttribute("href")).toBe("/forgot-password");
  expect(screen.getByRole("link", { name: "Hier registrieren" }).getAttribute("href")).toBe("/sign-up?invitation=invite%2Btoken");
  expect(screen.getByRole("status").textContent).toBe("Hinweis");
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(client.signIn.email).not.toHaveBeenCalled();
});

test("sign-in rejects invalid fields and exposes associated Field errors", async () => {
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = userEvent.setup();
  const email = screen.getByLabelText("E-Mail");
  await user.type(email, "invalid");
  await user.tab();
  const error = await screen.findByText("Bitte gib eine gültige E-Mail-Adresse ein.");
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(email.getAttribute("aria-describedby")).toBe(error.id);
  expect(email.closest('[data-slot="field"]')).not.toBeNull();
  fireEvent.submit(email.closest("form")!);
  expect(client.signIn.email).not.toHaveBeenCalled();
});

test("sign-in prevents duplicate requests and recovers from a network error", async () => {
  let fail!: (error: Error) => void;
  client.signIn.email.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await credentials();
  await user.click(screen.getByRole("button", { name: "Mit E-Mail anmelden" }));
  const pending = await screen.findByRole("button", { name: "Anmeldung läuft…" });
  expect(pending).toHaveProperty("disabled", true);
  await user.click(pending);
  expect(client.signIn.email).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("offline")));
  await screen.findByText("Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.");
  await user.click(screen.getByRole("button", { name: "Mit E-Mail anmelden" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
});

test("an unverified sign-in can resend verification and shows the returned error", async () => {
  client.signIn.email.mockResolvedValueOnce({ error: { code: "EMAIL_NOT_VERIFIED", message: "E-Mail nicht bestätigt" } });
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await credentials();
  await user.click(screen.getByRole("button", { name: "Mit E-Mail anmelden" }));
  expect((await screen.findByRole("alert")).textContent).toBe("E-Mail nicht bestätigt");
  await user.click(screen.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }));
  expect(client.sendVerificationEmail).toHaveBeenCalledWith({ email: "student@example.com", callbackURL: `${window.location.origin}/sign-in` });
  expect(router.replace).not.toHaveBeenCalled();
});

test("registration submits without an invitation and displays the server's rejection", async () => {
  client.signUp.email.mockResolvedValueOnce({ error: { message: "A valid invitation is required" } });
  render(<SignUpScreen apiOrigin="https://api.nunio.test" />);
  const user = await registration();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Mit E-Mail registrieren" }));
  expect((await screen.findByRole("alert")).textContent).toBe("A valid invitation is required");
  expect(client.signUp.email).toHaveBeenCalledWith({
    name: "Student", email: "student@example.com", password: "password123",
    callbackURL: `${window.location.origin}/sign-in`, fetchOptions: { headers: { "x-invitation-token": "" } },
  });
});

test("registration preserves the invitation and confirms email verification without navigating", async () => {
  render(<SignUpScreen apiOrigin="https://api.nunio.test" invitation="invitation-token" />);
  const user = await registration();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Mit E-Mail registrieren" }));
  await screen.findByRole("status");
  expect(client.signUp.email).toHaveBeenCalledWith({
    name: "Student", email: "student@example.com", password: "password123",
    callbackURL: `${window.location.origin}/sign-in`, fetchOptions: { headers: { "x-invitation-token": "invitation-token" } },
  });
  expect(router.replace).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }));
  expect(client.sendVerificationEmail).toHaveBeenCalledWith({ email: "student@example.com", callbackURL: `${window.location.origin}/sign-in` });
});

test("password confirmation is revalidated when the original password changes", async () => {
  render(<SignUpScreen apiOrigin="https://api.nunio.test" />);
  const user = await registration();
  const password = screen.getByLabelText("Passwort", { exact: true });
  await user.type(password, "changed");
  await screen.findByText("Die Passwörter stimmen nicht überein.");
  expect(screen.getByLabelText("Passwort bestätigen").getAttribute("aria-invalid")).toBe("true");
  await user.click(screen.getByRole("checkbox"));
  fireEvent.submit(password.closest("form")!);
  expect(client.signUp.email).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Passwort bestätigen"), "changed");
  await user.click(screen.getByRole("button", { name: "Mit E-Mail registrieren" }));
  await waitFor(() => expect(client.signUp.email).toHaveBeenCalledTimes(1));
});

test("terms must be accepted and their text and document links are available", async () => {
  render(<SignUpScreen apiOrigin="https://api.nunio.test" invitation="invitation-token" />);
  const user = await registration();
  await user.click(screen.getByRole("button", { name: "Mit E-Mail registrieren" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("checkbox").getAttribute("aria-invalid")).toBe("true");
  expect(client.signUp.email).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Allgemeinen Geschäftsbedingungen" }).getAttribute("href")).toBe("/terms");
  expect(screen.getByRole("link", { name: "Datenschutzerklärung" }).getAttribute("href")).toBe("/privacy");
  expect(screen.getByRole("link", { name: "Hier anmelden" }).getAttribute("href")).toBe("/sign-in?invitation=invitation-token");
  for (const provider of ["Microsoft", "Google"]) {
    expect(screen.getByRole("button", { name: `Mit ${provider} registrieren` })).toHaveProperty("disabled", true);
  }
});
