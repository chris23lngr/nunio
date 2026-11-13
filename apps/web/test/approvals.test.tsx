import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ApprovalsPanel } from "@/features/approvals/approvals-panel";
import { api } from "./api";
import { TestProviders } from "./providers";

const approval = {
  actionId: "7b0c3c3e-0000-4000-8000-000000000001",
  action: {
    kind: "studyBlock.move",
    work: { title: "Problem sheet 1", course: "Analysis I" },
    from: {
      start: "2026-11-17T09:00:00.000Z",
      end: "2026-11-17T10:00:00.000Z",
    },
    to: { start: "2026-11-18T14:00:00.000Z", end: "2026-11-18T15:00:00.000Z" },
  },
  fingerprint:
    "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12",
  expiresAt: "2026-11-24T08:00:00.000Z",
  responsibility: { id: "r-1", preset: "keep_course_organized" },
};

test("an Approval card shows the exact Action, and approving confirms exactly the fingerprint shown", async () => {
  let pending = [approval];
  const decisions: unknown[] = [];
  api.route("GET", "/api/me/approvals", () => Response.json(pending));
  api.route("GET", "/api/me/actions/unconfirmed", () => Response.json([]));
  api.route(
    "POST",
    `/api/me/approvals/${approval.actionId}`,
    async (request) => {
      decisions.push(await request.json());
      pending = [];
      return Response.json({ status: "ok" });
    },
  );
  render(
    <TestProviders>
      <ApprovalsPanel apiOrigin={api.origin} />
    </TestProviders>,
  );

  const card = await screen.findByRole("article", {
    name: /Move the block for Problem sheet 1/,
  });
  expect(within(card).getByText(/Analysis I/)).toBeTruthy();
  expect(
    within(card).getByText(/Keep this course organized asks/),
  ).toBeTruthy();
  expect(within(card).getByText(/ab12cd34/)).toBeTruthy();
  await userEvent.click(
    within(card).getByRole("button", { name: "Approve this move" }),
  );

  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  expect(decisions).toEqual([
    { decision: "approve", fingerprint: approval.fingerprint },
  ]);
});

test("denying sends no fingerprint, and a request that changed meanwhile is explained, not hidden", async () => {
  const decisions: unknown[] = [];
  api.route("GET", "/api/me/approvals", () => Response.json([approval]));
  api.route("GET", "/api/me/actions/unconfirmed", () => Response.json([]));
  api.route(
    "POST",
    `/api/me/approvals/${approval.actionId}`,
    async (request) => {
      decisions.push(await request.json());
      return Response.json({ error: "stale" }, { status: 409 });
    },
  );
  render(
    <TestProviders>
      <ApprovalsPanel apiOrigin={api.origin} />
    </TestProviders>,
  );

  const card = await screen.findByRole("article", {
    name: /Move the block for Problem sheet 1/,
  });
  await userEvent.click(within(card).getByRole("button", { name: "Don't" }));

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "This request changed or expired. Look at it again before deciding.",
  );
  expect(decisions).toEqual([{ decision: "deny" }]);
});

test("an Action nunio could not confirm waits for the student to say whether it happened", async () => {
  let unconfirmed = [{ actionId: approval.actionId, action: approval.action }];
  const resolutions: unknown[] = [];
  api.route("GET", "/api/me/approvals", () => Response.json([]));
  api.route("GET", "/api/me/actions/unconfirmed", () =>
    Response.json(unconfirmed),
  );
  api.route(
    "POST",
    `/api/me/actions/${approval.actionId}/resolve`,
    async (request) => {
      resolutions.push(await request.json());
      unconfirmed = [];
      return Response.json({ status: "ok" });
    },
  );
  render(
    <TestProviders>
      <ApprovalsPanel apiOrigin={api.origin} />
    </TestProviders>,
  );

  const card = await screen.findByRole("article", {
    name: /nunio could not confirm: move the block for Problem sheet 1/i,
  });
  await userEvent.click(
    within(card).getByRole("button", { name: "It didn't happen" }),
  );

  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  expect(resolutions).toEqual([{ resolution: "did_not_happen" }]);
});

test("an Approval card names the Task a Chat proposes to add or reopen, with no time", async () => {
  const task = (id: string, kind: string, title: string) => ({
    ...approval,
    actionId: id,
    action: {
      kind,
      work: { title, course: "Analysis I" },
      from: null,
      to: null,
    },
    responsibility: null,
  });
  api.route("GET", "/api/me/approvals", () =>
    Response.json([
      task(
        "7b0c3c3e-0000-4000-8000-000000000002",
        "task.create",
        "Vorlesung nacharbeiten",
      ),
      task(
        "7b0c3c3e-0000-4000-8000-000000000003",
        "task.reopen",
        "Blatt 3 nacharbeiten",
      ),
    ]),
  );
  api.route("GET", "/api/me/actions/unconfirmed", () => Response.json([]));
  render(
    <TestProviders>
      <ApprovalsPanel apiOrigin={api.origin} />
    </TestProviders>,
  );

  const add = await screen.findByRole("article", {
    name: "Add the Task Vorlesung nacharbeiten",
  });
  expect(within(add).getByText(/nunio asks for Analysis I\./)).toBeTruthy();
  expect(
    within(add).getByRole("button", { name: "Approve this Task" }),
  ).toBeTruthy();
  const reopen = screen.getByRole("article", {
    name: "Reopen the Task Blatt 3 nacharbeiten",
  });
  expect(
    within(reopen).getByRole("button", { name: "Approve reopening it" }),
  ).toBeTruthy();
});
