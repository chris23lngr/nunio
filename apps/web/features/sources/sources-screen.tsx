"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { uploadSource, deleteSource, readSourceAgain } from "./api/source-mutations";
import { sourceQueries, type Source } from "./api/source-queries";
import { SourceList } from "./components/source-list";
import { SourceUploadForm } from "./components/source-upload-form";

export function SourcesScreen({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(sourceQueries(apiOrigin));
  const sources = query.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useMutation(deleteSource(apiOrigin, queryClient));
  const uploadMutation = useMutation(uploadSource(apiOrigin, queryClient));
  const readAgainMutation = useMutation(readSourceAgain(apiOrigin, queryClient));
  const busy = deleteMutation.isPending || uploadMutation.isPending || readAgainMutation.isPending;

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("source") as HTMLInputElement).files?.[0];
    if (!file) return setError("Choose a PDF up to 20 MB.");
    setError(null);
    readAgainMutation.reset();
    deleteMutation.reset();
    uploadMutation.mutate(file, { onSuccess: () => form.reset() });
  }

  function remove(source: Source) {
    if (!window.confirm(`Delete ${source.title}? Its contents will be removed from nunio.`)) return;
    setError(null);
    readAgainMutation.reset();
    uploadMutation.reset();
    deleteMutation.mutate(source.id);
  }

  function readAgain(source: Source) {
    setError(null);
    uploadMutation.reset();
    deleteMutation.reset();
    readAgainMutation.mutate(source.id);
  }

  return (
    <section aria-labelledby="sources-title">
      <h1 id="sources-title">Sources</h1>
      <p>Upload course PDFs, including scans. Up to 20 MB and 100 pages per Source.</p>
      <SourceUploadForm onSubmit={upload} disabled={busy} uploading={uploadMutation.isPending} />
      {(error || uploadMutation.error || deleteMutation.error || readAgainMutation.error || query.error) && <p role="alert">{error ?? uploadMutation.error?.message ?? deleteMutation.error?.message ?? readAgainMutation.error?.message ?? query.error?.message}</p>}
      {query.isPending && <p role="status">Loading Sources…</p>}
      {query.isSuccess && sources.length === 0 && <p>No Sources yet. Upload a course PDF to get started.</p>}
      <SourceList sources={sources} disabled={busy}
        deletingId={deleteMutation.isPending ? deleteMutation.variables : undefined} onDelete={remove} onReadAgain={readAgain} />
    </section>
  );
}
