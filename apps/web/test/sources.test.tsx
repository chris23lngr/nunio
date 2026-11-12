import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const source = {
  id: "source-1",
  title: "Biology.pdf",
  status: "ready",
  extraction: "done",
  failure: null,
  courseId: null,
};
const analysis = {
  id: "course-1",
  code: "MA-101",
  title: "Analysis I",
  status: "accepted",
  semester: "2026-ws",
  color: "blue",
  entered: true,
  archived: false,
  next: null,
};
const courseList = (courses: unknown[]) => ({
  current: "2026-ws",
  choices: ["2026-ws"],
  courses,
});
beforeEach(() => {
  api.route("GET", "/api/me/courses", () => Response.json(courseList([])));
});

function Journey() {
  const [visible, setVisible] = useState(true);
  return (
    <TestProviders>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        Toggle Sources
      </button>
      {visible && <SourcesScreen apiOrigin={api.origin} />}
    </TestProviders>
  );
}

test("returning to Sources immediately shows recently loaded data without another request", async () => {
  let reads = 0;
  api.route("GET", `/api/me/sources`, () => {
    reads++;
    return Response.json([source]);
  });
  render(<Journey />);
  await screen.findByText(/Biology.pdf/);
  fireEvent.click(screen.getByText("Toggle Sources"));
  fireEvent.click(screen.getByText("Toggle Sources"));
  expect(screen.getByText(/Biology.pdf/)).toBeTruthy();
  expect(reads).toBe(1);
});

test("Sources follows extraction until review is ready, then stops polling", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let reads = 0;
  api.route("GET", `/api/me/sources`, () => {
    reads++;
    return Response.json([
      { ...source, extraction: reads === 1 ? "running" : "done" },
    ]);
  });
  render(<Journey />);
  await screen.findByText(/reading for review/);
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  await screen.findByText(/ready for review/);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(reads).toBe(2);
});

test("Sources distinguishes loading from an empty collection", async () => {
  let respond!: () => void;
  api.route("GET", `/api/me/sources`, async () => {
    await new Promise<void>((resolve) => {
      respond = resolve;
    });
    return Response.json([]);
  });
  render(<Journey />);
  expect(screen.getByRole("status").textContent).toBe("Loading Sources…");
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  respond();
  await screen.findByText(
    "No Sources yet. Upload a course PDF to get started.",
  );
});

test("uploading a PDF shows progress and refreshes Sources after processing is queued", async () => {
  let uploaded = false;
  let finish!: () => void;
  api.route("GET", `/api/me/sources`, () =>
    Response.json(
      uploaded ? [{ ...source, status: "queued", extraction: "pending" }] : [],
    ),
  );
  api.route("POST", `/api/me/sources`, async (request) => {
    expect(await request.json()).toEqual({
      title: "Biology.pdf",
      bytes: 4,
      type: "application/pdf",
      course: null,
    });
    return Response.json({
      source,
      upload: { url: `${api.origin}/upload`, headers: {} },
    });
  });
  api.route("PUT", "/upload", async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return new Response(null, { status: 200 });
  });
  api.route("POST", `/api/me/sources/source-1/complete`, () => {
    uploaded = true;
    return Response.json({ ...source, status: "queued" });
  });
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("PDF"),
    new File(["%PDF"], "Biology.pdf", { type: "application/pdf" }),
  );
  fireEvent.submit(screen.getByLabelText("PDF").closest("form")!);
  expect(
    (
      await screen.findByRole("button", { name: "Uploading PDF…" })
    ).hasAttribute("disabled"),
  ).toBe(true);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  await screen.findByText(/Biology.pdf — Waiting to process/);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Upload PDF" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
});

test("a failed deletion keeps the Source visible and reports the failure", async () => {
  let finish!: () => void;
  api.route("GET", `/api/me/sources`, () => Response.json([source]));
  api.route("DELETE", `/api/me/sources/source-1`, async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return Response.json({ error: "unavailable" }, { status: 503 });
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Journey />);
  await screen.findByText(/Biology.pdf/);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByRole("button", { name: "Deleting…" });
  expect(screen.getByText(/Biology.pdf/)).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not finish deletion. Please try again.",
  );
  expect(screen.getByText(/Biology.pdf/)).toBeTruthy();
});

test("successful deletion refreshes the remaining Sources and stays deleted on return", async () => {
  let deleted = false;
  api.route("GET", `/api/me/sources`, () =>
    Response.json(
      deleted
        ? [
            {
              ...source,
              id: "source-2",
              title: "Chemistry.pdf",
              extraction: "done",
            },
          ]
        : [
            source,
            {
              ...source,
              id: "source-2",
              title: "Chemistry.pdf",
              extraction: "running",
            },
          ],
    ),
  );
  api.route("DELETE", `/api/me/sources/source-1`, () => {
    deleted = true;
    return Response.json({ deleted: true });
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Journey />);
  await screen.findByText(/Biology.pdf/);
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
  await screen.findByText(/Chemistry.pdf — Ready, ready for review/);
  expect(screen.queryByText(/Biology.pdf/)).toBeNull();
  fireEvent.click(screen.getByText("Toggle Sources"));
  fireEvent.click(screen.getByText("Toggle Sources"));
  expect(screen.queryByText(/Biology.pdf/)).toBeNull();
  expect(screen.getByText(/Chemistry.pdf/)).toBeTruthy();
});

test("Read again queues extraction and refreshes the Source without allowing another request while pending", async () => {
  let queued = false;
  api.route("GET", `/api/me/sources`, () =>
    Response.json([{ ...source, extraction: queued ? "pending" : "done" }]),
  );
  api.route("POST", `/api/me/sources/source-1/extract`, () => {
    queued = true;
    return Response.json({ status: "queued" }, { status: 202 });
  });
  render(<Journey />);
  await screen.findByText(/Biology.pdf/);
  fireEvent.click(screen.getByRole("button", { name: "Read again" }));
  await screen.findByText(/waiting to be read/);
  expect(screen.queryByRole("button", { name: "Read again" })).toBeNull();
});

test("the Course choice offers accepted Courses that are not Archived, a new one, or automatic recognition", async () => {
  api.route("GET", "/api/me/courses", () =>
    Response.json(
      courseList([
        analysis,
        { ...analysis, id: "course-2", title: "Statistik", archived: true },
        { ...analysis, id: "course-3", title: "Chemie", status: "proposed" },
      ]),
    ),
  );
  api.route("GET", "/api/me/sources", () => Response.json([]));
  render(<Journey />);
  const select = screen.getByLabelText("Kurs");
  expect(select.textContent).toContain("Automatisch erkennen");
  await userEvent.click(select);
  await screen.findByRole("option", { name: "MA-101 Analysis I" });
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Automatisch erkennen", "MA-101 Analysis I", "Neuer Kurs …"]);
  await userEvent.keyboard("{Escape}");
  expect(select.textContent).toContain("Automatisch erkennen");
});

test("uploading several PDFs into a new Course creates it once and binds every file to it", async () => {
  const bodies: unknown[] = [];
  api.route("GET", "/api/me/sources", () => Response.json([]));
  api.route("POST", "/api/me/sources", async (request) => {
    const body = (await request.json()) as { title: string };
    bodies.push(body);
    const id = body.title === "Folien 1.pdf" ? "source-1" : "source-2";
    return Response.json({
      source: { ...source, id, title: body.title, courseId: "course-new" },
      upload: { url: `${api.origin}/upload`, headers: {} },
    });
  });
  api.route("PUT", "/upload", () => new Response(null, { status: 200 }));
  for (const id of ["source-1", "source-2"])
    api.route("POST", `/api/me/sources/${id}/complete`, () =>
      Response.json({ status: "queued" }),
    );
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();

  await user.upload(screen.getByLabelText("PDF"), [
    new File(["%PDF"], "Folien 1.pdf", { type: "application/pdf" }),
    new File(["%PDF"], "Folien 2.pdf", { type: "application/pdf" }),
  ]);
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(await screen.findByRole("option", { name: "Neuer Kurs …" }));
  await user.type(screen.getByLabelText("Titel"), "Analysis I");
  await user.type(screen.getByLabelText("Kürzel (optional)"), "MA-101");
  fireEvent.submit(screen.getByLabelText("PDF").closest("form")!);

  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies).toEqual([
    {
      title: "Folien 1.pdf",
      bytes: 4,
      type: "application/pdf",
      course: { title: "Analysis I", code: "MA-101" },
    },
    {
      title: "Folien 2.pdf",
      bytes: 4,
      type: "application/pdf",
      course: { id: "course-new" },
    },
  ]);
});

test("uploading into an existing Course binds the file to it, and reports a Course that is gone", async () => {
  api.route("GET", "/api/me/courses", () =>
    Response.json(courseList([analysis])),
  );
  api.route("GET", "/api/me/sources", () => Response.json([]));
  api.route("POST", "/api/me/sources", async (request) => {
    expect(await request.json()).toMatchObject({ course: { id: "course-1" } });
    return Response.json({ error: "gone" }, { status: 404 });
  });
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();

  await user.upload(
    screen.getByLabelText("PDF"),
    new File(["%PDF"], "Folien.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(
    await screen.findByRole("option", { name: "MA-101 Analysis I" }),
  );
  fireEvent.submit(screen.getByLabelText("PDF").closest("form")!);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Dieser Kurs ist nicht mehr verfügbar. Wähle einen anderen.",
  );
});

test("a multi-file upload that fails part-way selects the Course it created and retries only the files not yet done", async () => {
  const posted: { title: string; course: unknown }[] = [];
  let created = false;
  let failSecond = true;
  api.route("GET", "/api/me/courses", () =>
    Response.json(
      courseList(created ? [{ ...analysis, id: "course-new" }] : []),
    ),
  );
  api.route("GET", "/api/me/sources", () => Response.json([]));
  api.route("POST", "/api/me/sources", async (request) => {
    const body = (await request.json()) as { title: string; course: unknown };
    posted.push(body);
    created = true;
    return Response.json({
      source: {
        ...source,
        id: body.title.replace(" ", "-"),
        courseId: "course-new",
      },
      upload: {
        url: `${api.origin}/upload/${encodeURIComponent(body.title)}`,
        headers: {},
      },
    });
  });
  api.route("PUT", "/upload/Folien%201.pdf", () => new Response(null));
  api.route("PUT", "/upload/Folien%202.pdf", () => {
    if (!failSecond) return new Response(null);
    failSecond = false;
    return new Response(null, { status: 500 });
  });
  for (const id of ["Folien-1.pdf", "Folien-2.pdf"])
    api.route("POST", `/api/me/sources/${id}/complete`, () =>
      Response.json({ status: "queued" }),
    );
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("PDF"), [
    new File(["%PDF"], "Folien 1.pdf", { type: "application/pdf" }),
    new File(["%PDF"], "Folien 2.pdf", { type: "application/pdf" }),
  ]);
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(await screen.findByRole("option", { name: "Neuer Kurs …" }));
  await user.type(screen.getByLabelText("Titel"), "Analysis I");
  const form = screen.getByLabelText("PDF").closest("form")!;

  fireEvent.submit(form);
  await screen.findByText(/The upload did not finish/);
  await waitFor(() =>
    expect(screen.getByLabelText("Kurs").textContent).toContain(
      "MA-101 Analysis I",
    ),
  );
  expect(screen.queryByLabelText("Titel")).toBeNull();
  fireEvent.submit(form);

  await waitFor(() => expect(posted).toHaveLength(3));
  expect(posted.map(({ title, course }) => [title, course])).toEqual([
    ["Folien 1.pdf", { title: "Analysis I", code: null }],
    ["Folien 2.pdf", { id: "course-new" }],
    ["Folien 2.pdf", { id: "course-new" }],
  ]);
});

test("a finished upload returns the Course choice to automatic recognition, hiding the new-Course fields", async () => {
  api.route("GET", "/api/me/sources", () => Response.json([]));
  let sent: unknown;
  api.route("POST", "/api/me/sources", async (request) => {
    sent = ((await request.json()) as { course: unknown }).course;
    return Response.json({
      source: { ...source, courseId: "course-new" },
      upload: { url: `${api.origin}/upload`, headers: {} },
    });
  });
  api.route("PUT", "/upload", () => new Response(null));
  let completed = false;
  api.route("POST", "/api/me/sources/source-1/complete", () => {
    completed = true;
    return Response.json({ status: "queued" });
  });
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("PDF"),
    new File(["%PDF"], "Folien.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(await screen.findByRole("option", { name: "Neuer Kurs …" }));
  await user.type(screen.getByLabelText("Titel"), "Analysis I");

  fireEvent.submit(screen.getByLabelText("PDF").closest("form")!);

  await waitFor(() => expect(completed).toBe(true));
  expect(sent).toEqual({ title: "Analysis I", code: null });
  await waitFor(() =>
    expect(screen.getByLabelText("Kurs").textContent).toContain(
      "Automatisch erkennen",
    ),
  );
  expect(screen.queryByLabelText("Titel")).toBeNull();
});

test("a new Course named like an existing one is refused with that Course's name", async () => {
  api.route("GET", "/api/me/sources", () => Response.json([]));
  api.route("POST", "/api/me/sources", () =>
    Response.json(
      {
        error: "clash",
        course: {
          id: "course-1",
          title: "Analysis I",
          status: "accepted",
          archived: false,
        },
      },
      { status: 409 },
    ),
  );
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("PDF"),
    new File(["%PDF"], "Folien.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(await screen.findByRole("option", { name: "Neuer Kurs …" }));
  await user.type(screen.getByLabelText("Titel"), "analysis i");

  fireEvent.submit(screen.getByLabelText("PDF").closest("form")!);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Es gibt schon einen Kurs mit diesem Titel oder Kürzel: Analysis I. Wähle ihn aus, statt einen neuen anzulegen.",
  );
});
