"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { sourceDocumentQueries } from "./api/source-queries";
import { SourceCourse } from "./components/source-course";

export function SourceDocumentScreen({
  apiOrigin,
  sourceId,
  page,
}: {
  apiOrigin: string;
  sourceId: string;
  page?: string;
}) {
  const query = useQuery(sourceDocumentQueries(apiOrigin, sourceId));
  const [url, setUrl] = useState<string | null>(null);
  const requested = Number(page);
  const pageNumber =
    Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  useEffect(() => {
    if (!query.data) return;
    const objectUrl = URL.createObjectURL(query.data.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);
  return (
    <main className="flex h-[calc(100dvh-30px)] min-h-0 flex-col bg-white font-sans text-base-800">
      {query.isPending && (
        <p role="status" className="p-6">
          PDF laden …
        </p>
      )}
      {query.error ? (
        <p role="alert" className="p-6">
          {query.error.message}
        </p>
      ) : (
        query.data && (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 p-4">
              <h1 className="text-lg font-medium">{query.data.title}</h1>
              <span className="text-sm text-base-500">Seite {pageNumber}</span>
              {url && (
                <a
                  className="text-sm text-primary-600"
                  href={`${url}#page=${pageNumber}`}
                >
                  PDF öffnen
                </a>
              )}
            </header>
            <SourceCourse apiOrigin={apiOrigin} sourceId={sourceId} />
            {url && (
              <iframe
                title={query.data.title}
                src={`${url}#page=${pageNumber}`}
                className="min-h-0 w-full flex-1 border-0"
              />
            )}
          </>
        )
      )}
    </main>
  );
}
