import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/test/api";
import { TestProviders } from "@/test/providers";
import { SourceDocumentScreen } from "./source-document-screen";

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
