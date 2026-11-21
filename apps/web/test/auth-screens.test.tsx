import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SignInScreen } from "@/features/auth/sign-in-screen";
import { SignUpScreen } from "@/features/auth/sign-up-screen";

const { router, client } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  client: {
    emailOtp: { sendVerificationOtp: vi.fn() },
    signIn: { emailOtp: vi.fn(), passkey: vi.fn() },
    passkey: { listUserPasskeys: vi.fn(), addPasskey: vi.fn() },
    getSession: vi.fn(),
    updateUser: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: () => client }));

beforeEach(() => {
  vi.clearAllMocks();
  client.emailOtp.sendVerificationOtp.mockResolvedValue({ error: null });
  client.signIn.emailOtp.mockResolvedValue({ error: null });
  client.signIn.passkey.mockResolvedValue({ data: {}, error: null });
  client.passkey.listUserPasskeys.mockResolvedValue({ data: [], error: null });
  client.passkey.addPasskey.mockResolvedValue({ data: {}, error: null });
  client.getSession.mockResolvedValue({
    data: { user: { passkeyPromptDismissed: false } },
    error: null,
  });
  client.updateUser.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "PublicKeyCredential");
});

/** A browser that supports passkeys, optionally with autofill (conditional UI). */
function supportPasskeys(autofill = false) {
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: { isConditionalMediationAvailable: async () => autofill },
  });
}

async function requestCode(user = userEvent.setup()) {
  await user.type(screen.getByLabelText("E-Mail"), "student@example.com");
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  await screen.findByLabelText("Anmeldecode");
  return user;
}

test("sign-in sends a code and signs in once all six digits are entered", async () => {
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await requestCode();

  expect(client.emailOtp.sendVerificationOtp).toHaveBeenCalledWith({
    email: "student@example.com",
    type: "sign-in",
  });
  expect(screen.getByText(/student@example\.com/).textContent).toContain(
    "student@example.com",
  );
  await user.type(screen.getByLabelText("Anmeldecode"), "123456");

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.signIn.emailOtp).toHaveBeenCalledTimes(1);
  expect(client.signIn.emailOtp).toHaveBeenCalledWith({
    email: "student@example.com",
    otp: "123456",
  });
  expect(router.refresh).toHaveBeenCalled();
});

test("a wrong code marks the field invalid, explains why, and clears it", async () => {
  client.signIn.emailOtp.mockResolvedValueOnce({
    error: { status: 400, code: "INVALID_OTP", message: "Invalid OTP" },
  });
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await requestCode();
  const code = screen.getByLabelText("Anmeldecode");
  await user.type(code, "000000");

  const error = await screen.findByRole("alert");
  expect(error.textContent).toBe(
    "Der Code stimmt nicht. Prüfe ihn oder fordere einen neuen an.",
  );
  expect(code.getAttribute("aria-invalid")).toBe("true");
  expect(code.getAttribute("aria-describedby")).toBe(error.id);
  expect(code).toHaveProperty("value", "");
  expect(router.replace).not.toHaveBeenCalled();
  await user.type(code, "123456");
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
});

test.each([
  ["OTP_EXPIRED", 400, "Der Code ist abgelaufen. Fordere einen neuen an."],
  [
    "TOO_MANY_ATTEMPTS",
    403,
    "Zu viele falsche Versuche. Fordere einen neuen Code an.",
  ],
  [
    undefined,
    429,
    "Zu viele Versuche. Warte einen Moment und versuche es erneut.",
  ],
])("explains a refused code (%s)", async (code, status, message) => {
  client.signIn.emailOtp.mockResolvedValueOnce({
    error: { status, code, message: "server message" },
  });
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await requestCode();
  await user.type(screen.getByLabelText("Anmeldecode"), "123456");

  expect((await screen.findByRole("alert")).textContent).toBe(message);
});

test("another code can be requested after 60 seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await requestCode(
    userEvent.setup({ advanceTimers: vi.advanceTimersByTime }),
  );
  const resend = screen.getByRole("button", { name: /Neuen Code senden/ });
  expect(resend).toHaveProperty("disabled", true);
  expect(resend.textContent).toContain("60");

  await act(async () => vi.advanceTimersByTime(60_000));
  expect(resend).toHaveProperty("disabled", false);
  await user.click(resend);

  expect(client.emailOtp.sendVerificationOtp).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "Wir haben dir einen neuen Code geschickt.",
  );
  expect(resend).toHaveProperty("disabled", true);
});

test("“Andere E-Mail” returns to the address with it kept", async () => {
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await requestCode();
  await user.click(screen.getByRole("button", { name: "Andere E-Mail" }));

  expect(screen.getByLabelText("E-Mail")).toHaveProperty(
    "value",
    "student@example.com",
  );
  expect(screen.queryByLabelText("Anmeldecode")).toBeNull();
});

test("sign-in explains when too many codes were requested and stays on the address", async () => {
  client.emailOtp.sendVerificationOtp.mockResolvedValueOnce({
    error: { status: 429, message: "Too many requests" },
  });
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-Mail"), "student@example.com");
  await user.click(screen.getByRole("button", { name: "Code senden" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Zu viele Versuche. Warte einen Moment und versuche es erneut.",
  );
  expect(screen.queryByLabelText("Anmeldecode")).toBeNull();
});

test("sign-in prevents duplicate requests and recovers from a network error", async () => {
  let fail!: (error: Error) => void;
  client.emailOtp.sendVerificationOtp.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-Mail"), "student@example.com");
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  const pending = await screen.findByRole("button", {
    name: "Code wird gesendet…",
  });
  expect(pending).toHaveProperty("disabled", true);
  await user.click(pending);
  expect(client.emailOtp.sendVerificationOtp).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("offline")));
  await screen.findByText(
    "Der Code konnte nicht gesendet werden. Bitte versuche es erneut.",
  );
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  await screen.findByLabelText("Anmeldecode");
});

test("sign-in rejects an invalid address and exposes the associated Field error", async () => {
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = userEvent.setup();
  const email = screen.getByLabelText("E-Mail");
  await user.type(email, "invalid");
  await user.tab();
  const error = await screen.findByText(
    "Bitte gib eine gültige E-Mail-Adresse ein.",
  );
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(email.getAttribute("aria-describedby")).toBe(error.id);
  expect(email.closest('[data-slot="field"]')).not.toBeNull();
  fireEvent.submit(email.closest("form")!);
  expect(client.emailOtp.sendVerificationOtp).not.toHaveBeenCalled();
});

test("sign-in has disabled social buttons, no password, and links to registration", () => {
  render(
    <SignInScreen
      apiOrigin="https://api.nunio.test"
      invitation="invite+token"
      initialNotice="Hinweis"
    />,
  );
  for (const provider of ["Microsoft", "Google"]) {
    expect(
      screen.getByRole("button", { name: `Mit ${provider} anmelden` }),
    ).toHaveProperty("disabled", true);
  }
  expect(screen.queryByLabelText(/Passwort/)).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Hier registrieren" })
      .getAttribute("href"),
  ).toBe("/sign-up?invitation=invite%2Btoken");
  expect(screen.getByRole("status").textContent).toBe("Hinweis");
});

test("registration from an Invitation fixes the address, sends a code, and creates the account with the name", async () => {
  render(
    <SignUpScreen
      apiOrigin="https://api.nunio.test"
      invitation="invitation-token"
      email="student@example.com"
    />,
  );
  const user = userEvent.setup();
  const email = screen.getByLabelText("E-Mail");
  expect(email).toHaveProperty("value", "student@example.com");
  expect(email).toHaveProperty("readOnly", true);
  await user.type(screen.getByLabelText("Name"), "Student");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  await user.type(await screen.findByLabelText("Anmeldecode"), "123456");

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.emailOtp.sendVerificationOtp).toHaveBeenCalledWith({
    email: "student@example.com",
    type: "sign-in",
  });
  expect(client.signIn.emailOtp).toHaveBeenCalledWith({
    email: "student@example.com",
    otp: "123456",
    name: "Student",
    fetchOptions: { headers: { "x-invitation-token": "invitation-token" } },
  });
});

test("registration explains a refused Invitation", async () => {
  client.signIn.emailOtp.mockResolvedValueOnce({
    error: {
      status: 403,
      code: "INVITATION_REQUIRED",
      message: "A valid invitation is required",
    },
  });
  render(
    <SignUpScreen
      apiOrigin="https://api.nunio.test"
      invitation="invitation-token"
      email="student@example.com"
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Student");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  await user.type(await screen.findByLabelText("Anmeldecode"), "123456");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Deine Einladung ist ungültig, abgelaufen oder wurde schon verwendet.",
  );
});

test("registration without an Invitation explains that one is needed", () => {
  render(<SignUpScreen apiOrigin="https://api.nunio.test" />);

  expect(screen.getByRole("status").textContent).toContain(
    "Für die Registrierung brauchst du eine Einladung.",
  );
  expect(screen.queryByRole("button", { name: "Code senden" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "Hier anmelden" }).getAttribute("href"),
  ).toBe("/sign-in");
});

test("terms must be accepted and their text and document links are available", async () => {
  render(
    <SignUpScreen
      apiOrigin="https://api.nunio.test"
      invitation="invitation-token"
      email="student@example.com"
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Student");
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("checkbox").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(client.emailOtp.sendVerificationOtp).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("link", { name: "Allgemeinen Geschäftsbedingungen" })
      .getAttribute("href"),
  ).toBe("/terms");
  expect(
    screen
      .getByRole("link", { name: "Datenschutzerklärung" })
      .getAttribute("href"),
  ).toBe("/privacy");
  expect(
    screen.getByRole("link", { name: "Hier anmelden" }).getAttribute("href"),
  ).toBe("/sign-in?invitation=invitation-token");
  for (const provider of ["Microsoft", "Google"]) {
    expect(
      screen.getByRole("button", { name: `Mit ${provider} registrieren` }),
    ).toHaveProperty("disabled", true);
  }
});

test("the address field offers passkeys and “Mit Passkey anmelden” signs in with one", async () => {
  supportPasskeys();
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);

  expect(screen.getByLabelText("E-Mail").getAttribute("autocomplete")).toBe(
    "username webauthn",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Mit Passkey anmelden" }),
  );

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.signIn.passkey).toHaveBeenCalledWith();
});

test("sign-in starts passkey autofill where the browser supports it", async () => {
  supportPasskeys(true);
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);

  await waitFor(() =>
    expect(client.signIn.passkey).toHaveBeenCalledWith({ autoFill: true }),
  );
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
});

test("a cancelled passkey sign-in leaves the code sign-in usable", async () => {
  supportPasskeys();
  client.signIn.passkey.mockResolvedValueOnce({
    data: null,
    error: { code: "ERROR_CEREMONY_ABORTED", status: 400 },
  });
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Mit Passkey anmelden" }),
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Die Anmeldung mit Passkey hat nicht geklappt. Versuche es erneut oder melde dich mit einem Code an.",
  );
  expect(router.replace).not.toHaveBeenCalled();
  await requestCode();
});

test("after a code sign-in a student without a passkey is offered one", async () => {
  supportPasskeys();
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  const user = await requestCode();
  await user.type(screen.getByLabelText("Anmeldecode"), "123456");

  expect(
    await screen.findByRole("heading", { name: "Passkey einrichten?" }),
  ).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Passkey einrichten" }));

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.passkey.addPasskey).toHaveBeenCalledWith({
    name: expect.any(String),
  });
});

test("“Später” skips the passkey for now and “Nicht mehr fragen” stops asking", async () => {
  supportPasskeys();
  const { unmount } = render(
    <SignInScreen apiOrigin="https://api.nunio.test" />,
  );
  let user = await requestCode();
  await user.type(screen.getByLabelText("Anmeldecode"), "123456");
  await user.click(await screen.findByRole("button", { name: "Später" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.updateUser).not.toHaveBeenCalled();
  unmount();

  router.replace.mockClear();
  render(<SignInScreen apiOrigin="https://api.nunio.test" />);
  user = await requestCode();
  await user.type(screen.getByLabelText("Anmeldecode"), "123456");
  await user.click(
    await screen.findByRole("button", { name: "Nicht mehr fragen" }),
  );
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(client.updateUser).toHaveBeenCalledWith({
    passkeyPromptDismissed: true,
  });
  expect(client.passkey.addPasskey).not.toHaveBeenCalled();
});

test.each([
  ["already has a passkey", [{ id: "p1" }], false],
  ["asked not to be asked again", [], true],
])(
  "a student who %s goes straight to the app",
  async (_case, passkeys, dismissed) => {
    supportPasskeys();
    client.passkey.listUserPasskeys.mockResolvedValue({
      data: passkeys,
      error: null,
    });
    client.getSession.mockResolvedValue({
      data: { user: { passkeyPromptDismissed: dismissed } },
      error: null,
    });
    render(<SignInScreen apiOrigin="https://api.nunio.test" />);
    const user = await requestCode();
    await user.type(screen.getByLabelText("Anmeldecode"), "123456");

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(
      screen.queryByRole("heading", { name: "Passkey einrichten?" }),
    ).toBeNull();
  },
);

test("registration offers a passkey once the account exists", async () => {
  supportPasskeys();
  render(
    <SignUpScreen
      apiOrigin="https://api.nunio.test"
      invitation="invitation-token"
      email="student@example.com"
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Student");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Code senden" }));
  await user.type(await screen.findByLabelText("Anmeldecode"), "123456");

  expect(
    await screen.findByRole("heading", { name: "Passkey einrichten?" }),
  ).toBeTruthy();
});
