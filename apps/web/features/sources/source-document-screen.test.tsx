import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/test/api";
import { TestProviders } from "@/test/providers";
import { SourceDocumentScreen } from "./source-document-screen";

const source = {
  id: "source-1",
  title: "Notizen.pdf",
  status: "ready",
  extraction: "done",
  failure: null,
  courseId: "course-1",
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
function routes(sources = [source]) {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = () => "blob:test-pdf";
      static override revokeObjectURL = () => {};
    },
  );
  api.route("GET", "/api/me/sources/source-1/download", () =>
    Response.json({
      title: "Notizen.pdf",
      url: `${api.origin}/pdf`,
      headers: {},
    }),
  );
  api.route("GET", "/pdf", () => new Response("%PDF-1.7"));
  api.route("GET", "/api/me/sources", () => Response.json(sources));
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [analysis],
    }),
  );
}
beforeEach(() => {
  api.route("GET", "/api/me/sources", () => Response.json([source]));
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [analysis],
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
test("a cited PDF is fetched with its download headers and opens at the cited page", async () => {
  const createObjectURL = vi.fn(() => "blob:test-pdf");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    },
  );
  api.route("GET", "/api/me/sources/source-1/download", () =>
    Response.json({
      title: "Notizen.pdf",
      url: `${api.origin}/pdf`,
      headers: { "x-amz-server-side-encryption-customer-key": "test-key" },
    }),
  );
  api.route("GET", "/pdf", (request) => {
    expect(
      request.headers.get("x-amz-server-side-encryption-customer-key"),
    ).toBe("test-key");
    return new Response("%PDF-1.7", {
      headers: { "content-type": "application/pdf" },
    });
  });
  const view = render(
    <TestProviders>
      <SourceDocumentScreen
        apiOrigin={api.origin}
        sourceId="source-1"
        page="2"
      />
    </TestProviders>,
  );
  await screen.findByRole("heading", { name: "Notizen.pdf" });
  await waitFor(() =>
    expect(screen.getByTitle("Notizen.pdf").getAttribute("src")).toBe(
      "blob:test-pdf#page=2",
    ),
  );
  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-pdf");
});

test("Kurs ändern binds the Source to another choice and reads it again", async () => {
  routes();
  let bodies: unknown[] = [];
  api.route("POST", "/api/me/sources/source-1/course", async (request) => {
    bodies = [...bodies, await request.json()];
    return Response.json({ status: "queued" }, { status: 202 });
  });
  render(
    <TestProviders>
      <SourceDocumentScreen apiOrigin={api.origin} sourceId="source-1" />
    </TestProviders>,
  );
  await screen.findByText("Kurs: MA-101 Analysis I");
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Kurs ändern" }));
  expect(screen.getByLabelText("Kurs").textContent).toContain(
    "MA-101 Analysis I",
  );
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(
    await screen.findByRole("option", { name: "Automatisch erkennen" }),
  );
  await user.click(screen.getByRole("button", { name: "Neu lesen" }));

  await screen.findByText(
    "Wird neu gelesen. Was nunio darin findet, ersetzt danach die bisherigen Ergebnisse.",
  );
  expect(bodies).toEqual([{ course: null }]);
});

test("Kurs ändern is unavailable while the Source is read, and reports a reading that started meanwhile", async () => {
  routes([{ ...source, extraction: "running" }]);
  const view = render(
    <TestProviders>
      <SourceDocumentScreen apiOrigin={api.origin} sourceId="source-1" />
    </TestProviders>,
  );
  await screen.findByText("Kurs: MA-101 Analysis I");
  expect(screen.queryByRole("button", { name: "Kurs ändern" })).toBeNull();
  view.unmount();

  routes();
  api.route("POST", "/api/me/sources/source-1/course", () =>
    Response.json({ error: "running" }, { status: 409 }),
  );
  render(
    <TestProviders>
      <SourceDocumentScreen apiOrigin={api.origin} sourceId="source-1" />
    </TestProviders>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Kurs ändern" }));
  await user.click(screen.getByRole("button", { name: "Neu lesen" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Diese Quelle wird gerade gelesen. Ändere den Kurs, sobald das fertig ist.",
  );
});

test("Kurs ändern keeps a changed Course when reading could not start, and starts it from the Source page", async () => {
  routes();
  let changed = false;
  let extracted = false;
  api.route("GET", "/api/me/sources", () =>
    Response.json([
      changed ? { ...source, courseId: null, extraction: "pending" } : source,
    ]),
  );
  api.route("POST", "/api/me/sources/source-1/course", () => {
    changed = true;
    return Response.json({ error: "not_started" }, { status: 503 });
  });
  api.route("POST", "/api/me/sources/source-1/extract", () => {
    extracted = true;
    return Response.json({ status: "queued" }, { status: 202 });
  });
  render(
    <TestProviders>
      <SourceDocumentScreen apiOrigin={api.origin} sourceId="source-1" />
    </TestProviders>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Kurs ändern" }));
  await user.click(screen.getByLabelText("Kurs"));
  await user.click(
    await screen.findByRole("option", { name: "Automatisch erkennen" }),
  );
  await user.click(screen.getByRole("button", { name: "Neu lesen" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Der Kurs ist geändert, aber das Lesen konnte nicht starten. Starte es hier erneut.",
  );
  await user.click(
    await screen.findByRole("button", { name: "Lesen starten" }),
  );
  await waitFor(() => expect(extracted).toBe(true));
});

test("Kurs ändern shows an Archived bound Course as the current choice, and waits for the Course list", async () => {
  routes([source]);
  let respond!: () => void;
  api.route("GET", "/api/me/courses", async () => {
    await new Promise<void>((resolve) => {
      respond = resolve;
    });
    return Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [{ ...analysis, archived: true }],
    });
  });
  render(
    <TestProviders>
      <SourceDocumentScreen apiOrigin={api.origin} sourceId="source-1" />
    </TestProviders>,
  );
  await screen.findByRole("heading", { name: "Notizen.pdf" });
  expect(screen.queryByRole("button", { name: "Kurs ändern" })).toBeNull();
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  respond();

  await screen.findByText("Kurs: MA-101 Analysis I (archiviert)");
  await userEvent.click(screen.getByRole("button", { name: "Kurs ändern" }));
  expect(screen.getByLabelText("Kurs").textContent).toContain(
    "MA-101 Analysis I",
  );
});
