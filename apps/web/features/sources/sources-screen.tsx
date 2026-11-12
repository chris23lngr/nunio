"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import {
  deleteSource,
  readSourceAgain,
  uploadSource,
} from "./api/source-mutations";
import type { Source } from "./api/source-queries";
import { sourceQueries } from "./api/source-queries";
import { courseChoiceFrom } from "./components/course-choice-fields";
import { SourceList } from "./components/source-list";
import { SourceUploadForm } from "./components/source-upload-form";

export function SourcesScreen({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(sourceQueries(apiOrigin));
  const sources = query.data ?? [];
  const courses = useQuery(courseListQuery(apiOrigin)).data?.courses ?? [];
  const [error, setError] = useState<string | null>(null);
  const [course, setCourse] = useState("");
  // Files of the current selection already uploaded, which a retry after a part-way failure skips.
  const done = useRef(new WeakSet<File>());
  const deleteMutation = useMutation(deleteSource(apiOrigin, queryClient));
  const uploadMutation = useMutation(uploadSource(apiOrigin, queryClient));
  const readAgainMutation = useMutation(
    readSourceAgain(apiOrigin, queryClient),
  );
  const busy =
    deleteMutation.isPending ||
    uploadMutation.isPending ||
    readAgainMutation.isPending;

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = [
      ...((form.elements.namedItem("source") as HTMLInputElement).files ?? []),
    ];
    if (!files.length) return setError("Choose a PDF up to 20 MB.");
    setError(null);
    readAgainMutation.reset();
    deleteMutation.reset();
    uploadMutation.mutate(
      {
        files,
        course: courseChoiceFrom(course, form),
        done: done.current,
        // A retry binds to the Course this upload created instead of creating another.
        onCourse: setCourse,
      },
      {
        onSuccess: () => {
          form.reset();
          setCourse("");
          done.current = new WeakSet();
        },
      },
    );
  }

  function remove(source: Source) {
    if (
      !window.confirm(
        `Delete ${source.title}? Its contents will be removed from nunio.`,
      )
    )
      return;
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
      <p>
        Upload course PDFs, including scans. Up to 20 MB and 100 pages per
        Source.
      </p>
      <SourceUploadForm
        onSubmit={upload}
        courses={courses}
        course={course}
        onCourse={setCourse}
        disabled={busy}
        uploading={uploadMutation.isPending}
      />
      {(error ||
        uploadMutation.error ||
        deleteMutation.error ||
        readAgainMutation.error ||
        query.error) && (
        <p role="alert">
          {error ??
            uploadMutation.error?.message ??
            deleteMutation.error?.message ??
            readAgainMutation.error?.message ??
            query.error?.message}
        </p>
      )}
      {query.isPending && <p role="status">Loading Sources…</p>}
      {query.isSuccess && sources.length === 0 && (
        <p>No Sources yet. Upload a course PDF to get started.</p>
      )}
      <SourceList
        sources={sources}
        disabled={busy}
        deletingId={
          deleteMutation.isPending ? deleteMutation.variables : undefined
        }
        onDelete={remove}
        onReadAgain={readAgain}
      />
    </section>
  );
}
