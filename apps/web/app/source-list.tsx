"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import { useEffect, useState, type FormEvent } from "react";

type Source = paths["/api/me/sources"]["get"]["responses"][200]["content"]["application/json"][number];
const labels: Record<Source["status"], string> = {
  uploading: "Waiting for upload", queued: "Waiting to process", processing: "Processing", ready: "Ready",
  failed: "Processing stopped. Contact support before trying again.", deleted: "Deleted",
};
export function SourceList({ apiOrigin }: { apiOrigin: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await createApiClient(apiOrigin).GET("/api/me/sources");
        if (cancelled) return;
        if (!result.data) return setError("Could not load your Sources.");
        setSources(result.data);
      } catch { if (!cancelled) setError("Could not load your Sources."); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [apiOrigin, version]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("source");
    if (!(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024
      || !file.name.toLowerCase().endsWith(".pdf")) return setError("Choose a PDF up to 20 MB.");
    setBusy(true); setError(null);
    const client = createApiClient(apiOrigin);
    try {
      const created = await client.POST("/api/me/sources", { body: { title: file.name, bytes: file.size, type: "application/pdf" } });
      if (!created.data) throw new Error(created.response.status === 403 ? "New uploads are unavailable for this account." : "Could not start the upload.");
      const { source, upload } = created.data;
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file, credentials: "omit" });
      if (!put.ok) throw new Error("The upload did not finish. You can delete the unfinished Source below.");
      const completed = await client.POST("/api/me/sources/{id}/complete", { params: { path: { id: source.id } } });
      if (!completed.data) throw new Error("Could not start processing. Contact support before trying again.");
      form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not upload the PDF."); }
    finally { setBusy(false); setVersion(v => v + 1); }
  }
  async function remove(source: Source) {
    if (!window.confirm(`Delete ${source.title}? Its contents will be removed from nunio.`)) return;
    setBusy(true); setError(null);
    try {
      const result = await createApiClient(apiOrigin).DELETE("/api/me/sources/{id}", { params: { path: { id: source.id } } });
      if (!result.data) throw new Error("Could not finish deletion. Please try again.");
      setSources(current => current.filter(item => item.id !== source.id));
    } catch { setError("Could not finish deletion. Please try again."); }
    finally { setBusy(false); setVersion(v => v + 1); }
  }
  return (
    <section aria-labelledby="sources-title">
      <h1 id="sources-title">Sources</h1>
      <p>Upload course PDFs, including scans. Up to 20 MB and 100 pages per Source.</p>
      <form onSubmit={upload}>
        <label>PDF <input name="source" type="file" accept="application/pdf,.pdf" required disabled={busy} /></label>
        <button type="submit" disabled={busy}>{busy ? "Please wait…" : "Upload PDF"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>{sources.map(source => <li key={source.id}>
        <span>{source.title} — {labels[source.status]}</span>{" "}
        <button type="button" disabled={busy} onClick={() => { void remove(source); }}>Delete</button>
      </li>)}</ul>
    </section>
  );
}
