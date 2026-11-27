import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { OwnWork } from "@/features/study/components/own-work";
import { api } from "./api";
import { TestProviders } from "./providers";

const obligationId = "0b000000-0000-4000-8000-000000000001";
const base = `/api/me/obligations/${obligationId}/own-work`;
const solution = {
  id: "f0000000-0000-4000-8000-000000000001",
  name: "Lösung.pdf",
  bytes: 1_258_291,
  status: "ready",
  uploadedAt: "2026-11-20T14:20:00.000Z",
};

function renderOwnWork() {
  render(
    <TestProviders>
      <OwnWork apiOrigin={api.origin} obligationId={obligationId} />
    </TestProviders>,
  );
}

test("lists Own Work by name, size and upload time, pending until it is ready, and says when it was not stored", async () => {
  api.route("GET", base, () =>
    Response.json([
      solution,
      {
        id: "f0000000-0000-4000-8000-000000000002",
        name: "Anhang.zip",
        bytes: 2_048,
        status: "promoting",
        uploadedAt: "2026-11-21T09:00:00.000Z",
      },
      {
        id: "f0000000-0000-4000-8000-000000000003",
        name: "Entwurf.docx",
        bytes: 512,
        status: "failed",
        uploadedAt: "2026-11-21T09:05:00.000Z",
      },
      {
        id: "f0000000-0000-4000-8000-000000000004",
        name: "Notizen.txt",
        bytes: 100,
        status: "uploading",
        uploadedAt: "2026-11-21T09:10:00.000Z",
      },
    ]),
  );
  renderOwnWork();

  const list = await screen.findByRole("list", { name: "Eigene Arbeit" });
  const [ready, pending, failed, unfinished] =
    within(list).getAllByRole("listitem");
  expect(ready!.textContent).toContain("Lösung.pdf");
  expect(ready!.textContent).toContain("1,2 MB");
  expect(ready!.textContent).toContain("20. Nov.");
  expect(ready!.textContent).not.toContain("Wird gespeichert");
  expect(pending!.textContent).toContain("Anhang.zip");
  expect(pending!.textContent).toContain("2 KB");
  expect(pending!.textContent).toContain("Wird gespeichert");
  expect(failed!.textContent).toContain(
    "Nicht gespeichert. Lösche die Datei und lade sie erneut hoch.",
  );
  expect(unfinished!.textContent).toContain(
    "Nicht fertig hochgeladen. Lösche die Datei und lade sie erneut hoch.",
  );
});

test("uploading a file puts it in quarantine, confirms it, and shows it pending", async () => {
  let files: (typeof solution)[] = [];
  const steps: string[] = [];
  api.route("GET", base, () => Response.json(files));
  api.route("POST", base, async (request) => {
    const body = (await request.json()) as { name: string; bytes: number };
    steps.push(`create ${body.name} ${body.bytes}`);
    const file = {
      ...solution,
      name: body.name,
      bytes: body.bytes,
      status: "uploading",
    };
    files = [file];
    return Response.json(
      {
        file,
        upload: {
          url: `${api.origin}/upload`,
          headers: { "x-amz-server-side-encryption-customer-key": "key" },
          expiresAt: "2026-11-20T14:25:00.000Z",
        },
      },
      { status: 201 },
    );
  });
  api.route("PUT", "/upload", (request) => {
    // jsdom's File does not reach Node's fetch as bytes; the SSE-C header shows the PUT went to quarantine.
    steps.push(
      `put ${request.headers.get("x-amz-server-side-encryption-customer-key")}`,
    );
    return new Response(null);
  });
  api.route("POST", `${base}/${solution.id}/confirm`, () => {
    steps.push("confirm");
    files = [{ ...files[0]!, status: "promoting" }];
    return Response.json({ status: "queued" }, { status: 202 });
  });
  const user = userEvent.setup();
  renderOwnWork();

  await user.upload(
    await screen.findByLabelText("Eigene Arbeit hochladen"),
    new File(["Meine Lösung"], "Lösung.pdf", { type: "application/pdf" }),
  );

  const list = await screen.findByRole("list", { name: "Eigene Arbeit" });
  await within(list).findByText("Wird gespeichert…");
  expect(steps).toEqual(["create Lösung.pdf 13", "put key", "confirm"]);
});

test("refuses a file over 14 MB before uploading anything", async () => {
  api.route("GET", base, () => Response.json([]));
  const user = userEvent.setup();
  renderOwnWork();
  const big = new File(["x"], "Video.mp4");
  Object.defineProperty(big, "size", { value: 14 * 1024 * 1024 + 1 });

  await user.upload(
    await screen.findByLabelText("Eigene Arbeit hochladen"),
    big,
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Eine Datei darf höchstens 14 MB groß sein.",
  );
});

test("refuses an empty file with its own message", async () => {
  api.route("GET", base, () => Response.json([]));
  const user = userEvent.setup();
  renderOwnWork();

  await user.upload(
    await screen.findByLabelText("Eigene Arbeit hochladen"),
    new File([], "Leer.pdf"),
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Leere Dateien können nicht hochgeladen werden.",
  );
});

test("deleting a file removes it from the list", async () => {
  let files = [solution];
  api.route("GET", base, () => Response.json(files));
  api.route("DELETE", `${base}/${solution.id}`, () => {
    files = [];
    return Response.json({ status: "deleted" }, { status: 202 });
  });
  const user = userEvent.setup();
  renderOwnWork();

  await user.click(
    await screen.findByRole("button", { name: "Lösung.pdf löschen" }),
  );

  await screen.findByText("Noch keine Datei");
  expect(screen.queryByText("Lösung.pdf")).toBeNull();
});
