import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { Providers } from "@/app/providers";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { server } from "./setup";

const origin = "https://api.nunio.test";
const source = { id: "source-1", title: "Biology.pdf", status: "ready", extraction: "done", failure: null };

function Journey() {
  const [visible, setVisible] = useState(true);
  return <Providers>
    <button onClick={() => setVisible(value => !value)}>Toggle Sources</button>
    {visible && <SourcesScreen apiOrigin={origin} />}
  </Providers>;
}

test("returning to Sources immediately shows recently loaded data without another request", async () => {
  let reads = 0;
  server.use(http.get(`${origin}/api/me/sources`, () => {
    reads++;
    return HttpResponse.json([source]);
  }));
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
  server.use(http.get(`${origin}/api/me/sources`, () => {
    reads++;
    return HttpResponse.json([{ ...source, extraction: reads === 1 ? "running" : "done" }]);
  }));
  render(<Journey />);
  await screen.findByText(/reading for review/);
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  await screen.findByText(/ready for review/);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(reads).toBe(2);
});

test("Sources distinguishes loading from an empty collection", async () => {
  let respond!: () => void;
  server.use(http.get(`${origin}/api/me/sources`, async () => {
    await new Promise<void>(resolve => { respond = resolve; });
    return HttpResponse.json([]);
  }));
  render(<Journey />);
  expect(screen.getByRole("status").textContent).toBe("Loading Sources…");
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  respond();
  await screen.findByText("No Sources yet. Upload a course PDF to get started.");
});

test("uploading a PDF shows progress and refreshes Sources after processing is queued", async () => {
  let uploaded = false;
  let finish!: () => void;
  server.use(
    http.get(`${origin}/api/me/sources`, () => HttpResponse.json(uploaded ? [{ ...source, status: "queued", extraction: "pending" }] : [])),
    http.post(`${origin}/api/me/sources`, async ({ request }) => {
      expect(await request.json()).toEqual({ title: "Biology.pdf", bytes: 4, type: "application/pdf" });
      return HttpResponse.json({ source, upload: { url: "https://storage.test/upload", headers: {} } });
    }),
    http.put("https://storage.test/upload", async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return new HttpResponse(null, { status: 200 });
    }),
    http.post(`${origin}/api/me/sources/source-1/complete`, () => {
      uploaded = true;
      return HttpResponse.json({ ...source, status: "queued" });
    }),
  );
  render(<Journey />);
  await screen.findByText(/No Sources yet/);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("PDF"), new File(["%PDF"], "Biology.pdf", { type: "application/pdf" }));
  fireEvent.submit(screen.getByLabelText("PDF").closest("form")!);
  expect((await screen.findByRole("button", { name: "Uploading PDF…" })).hasAttribute("disabled")).toBe(true);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  await screen.findByText(/Biology.pdf — Waiting to process/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Upload PDF" }).hasAttribute("disabled")).toBe(false));
});

test("a failed deletion keeps the Source visible and reports the failure", async () => {
  let finish!: () => void;
  server.use(
    http.get(`${origin}/api/me/sources`, () => HttpResponse.json([source])),
    http.delete(`${origin}/api/me/sources/source-1`, async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return HttpResponse.json({ error: "unavailable" }, { status: 503 });
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Journey />);
  await screen.findByText(/Biology.pdf/);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByRole("button", { name: "Deleting…" });
  expect(screen.getByText(/Biology.pdf/)).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  expect((await screen.findByRole("alert")).textContent).toBe("Could not finish deletion. Please try again.");
  expect(screen.getByText(/Biology.pdf/)).toBeTruthy();
});

test("successful deletion refreshes the remaining Sources and stays deleted on return", async () => {
  let deleted = false;
  server.use(
    http.get(`${origin}/api/me/sources`, () => HttpResponse.json(deleted
      ? [{ ...source, id: "source-2", title: "Chemistry.pdf", extraction: "done" }]
      : [source, { ...source, id: "source-2", title: "Chemistry.pdf", extraction: "running" }])),
    http.delete(`${origin}/api/me/sources/source-1`, () => {
      deleted = true;
      return HttpResponse.json({ deleted: true });
    }),
  );
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
  server.use(
    http.get(`${origin}/api/me/sources`, () => HttpResponse.json([{ ...source, extraction: queued ? "pending" : "done" }])),
    http.post(`${origin}/api/me/sources/source-1/extract`, () => {
      queued = true;
      return HttpResponse.json({ status: "queued" }, { status: 202 });
    }),
  );
  render(<Journey />);
  await screen.findByText(/Biology.pdf/);
  fireEvent.click(screen.getByRole("button", { name: "Read again" }));
  await screen.findByText(/waiting to be read/);
  expect(screen.queryByRole("button", { name: "Read again" })).toBeNull();
});
