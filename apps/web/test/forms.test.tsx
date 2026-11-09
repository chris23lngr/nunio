import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";
import { DeletionForm } from "@/app/account/deletion-form";
import { TestProviders } from "./providers";
import { api } from "./api";

const { router, client } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  client: {
    resetPassword: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: () => client }));

beforeEach(() => {
  vi.clearAllMocks();
  client.resetPassword.mockResolvedValue({ error: null });
});

test("password reset validates length, blocks duplicate submissions, and can retry a server error", async () => {
  let finish!: (result: { error: { message: string } }) => void;
  client.resetPassword.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ResetPasswordForm apiOrigin={api.origin} token="reset-token" />);
  const user = userEvent.setup();
  const input = screen.getByLabelText("New password");
  await user.type(input, "short");
  await user.tab();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Use between 8 and 128 characters.");
  // Submit directly to verify the form's validator independently of browser constraints.
  fireEvent.submit(input.closest("form")!);
  expect(client.resetPassword).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "new-password");
  const button = screen.getByRole("button", { name: "Reset password" });
  await user.click(button);
  await waitFor(() => expect(button).toHaveProperty("disabled", true));
  await user.click(button);
  expect(client.resetPassword).toHaveBeenCalledTimes(1);
  await act(async () => finish({ error: { message: "Link expired" } }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Link expired");
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  await user.click(button);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in?reset=success"));
  expect(client.resetPassword).toHaveBeenLastCalledWith({ token: "reset-token", newPassword: "new-password" });
});

test("account deletion keeps incorrect-password feedback and submits the corrected password", async () => {
  const passwords: string[] = [];
  api.route("POST", "/api/me/deletion-request", async request => {
    const { password } = await request.json() as { password: string };
    passwords.push(password);
    return password === "correct-password" ? Response.json({}, { status: 202 }) : Response.json({}, { status: 403 });
  });
  render(<TestProviders><DeletionForm apiOrigin={api.origin} /></TestProviders>);
  const user = userEvent.setup();
  const input = screen.getByLabelText("Password");
  await user.type(input, "wrong-password");
  await user.click(screen.getByRole("button", { name: "Request account deletion" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "That password is incorrect.");
  await user.clear(input);
  await user.type(input, "correct-password");
  await user.click(screen.getByRole("button", { name: "Request account deletion" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in?deletion=requested"));
  expect(passwords).toEqual(["wrong-password", "correct-password"]);
  expect(router.refresh).toHaveBeenCalled();
});
