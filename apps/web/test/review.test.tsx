import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { ReviewList } from "@/app/(app)/review/review-list";
import { api } from "./api";

const course = (id: string, title: string, status: string) => ({
  id,
  code: null,
  title,
  status,
  archived: false,
  obligations: [],
  facts: [],
});
const analysis = course("course-1", "Analysis I", "accepted");
const similar = course("course-2", "Analysis 1", "proposed");
let suggestions: unknown[] = [];

beforeEach(() => {
  suggestions = [{ courseId: similar.id, intoId: analysis.id }];
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: [similar, analysis] }),
  );
  api.route("GET", "/api/me/courses/merge-suggestions", () =>
    Response.json(suggestions),
  );
});

const suggestion = async () =>
  within(await screen.findByRole("article", { name: "Analysis 1" })).findByText(
    "Ähnlich zu Analysis I – zusammenführen?",
  );

test("Review suggests merging a Course into one it looks like, and merges it on request", async () => {
  let merged: unknown;
  api.route("POST", `/api/me/courses/${similar.id}/merge`, async (request) => {
    merged = await request.json();
    suggestions = [];
    return Response.json({ status: "ok" });
  });
  render(<ReviewList apiOrigin={api.origin} />);
  await suggestion();

  await userEvent.click(screen.getByRole("button", { name: "Zusammenführen" }));

  await waitFor(() => expect(merged).toEqual({ into: analysis.id }));
  await waitFor(() =>
    expect(
      screen.queryByText("Ähnlich zu Analysis I – zusammenführen?"),
    ).toBeNull(),
  );
});

test("Nein, verschieden keeps two Courses apart for good", async () => {
  let keptApart: unknown;
  api.route(
    "POST",
    `/api/me/courses/${similar.id}/keep-apart`,
    async (request) => {
      keptApart = await request.json();
      suggestions = [];
      return Response.json({ status: "ok" });
    },
  );
  render(<ReviewList apiOrigin={api.origin} />);
  await suggestion();

  await userEvent.click(
    screen.getByRole("button", { name: "Nein, verschieden" }),
  );

  await waitFor(() => expect(keptApart).toEqual({ other: analysis.id }));
  await waitFor(() =>
    expect(
      screen.queryByText("Ähnlich zu Analysis I – zusammenführen?"),
    ).toBeNull(),
  );
});
