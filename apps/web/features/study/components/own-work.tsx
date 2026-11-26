import type { paths } from "@nunio/api-client";
import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { FileText, LoaderCircle, Trash2 } from "lucide-react";
import { useId, useRef } from "react";
import { createApiClient } from "@/lib/api-client";
import { draftDateText } from "../study-format";

type OwnWorkFile =
  paths["/api/me/obligations/{id}/own-work"]["get"]["responses"][200]["content"]["application/json"][number];

const maxBytes = 14 * 1024 * 1024;
const size = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** "512 B", "2 KB", "1,2 MB". */
function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${size.format(bytes / 1024)} KB`;
  return `${size.format(bytes / (1024 * 1024))} MB`;
}

function ownWorkQuery(apiOrigin: string, obligationId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "own-work", obligationId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/obligations/{id}/own-work",
        { params: { path: { id: obligationId } }, signal },
      );
      if (!result.data)
        throw new Error("Deine Dateien konnten nicht geladen werden.");
      return result.data;
    },
    // Until the worker has promoted every confirmed file.
    refetchInterval: (query) =>
      query.state.data?.some((file) => file.status === "promoting")
        ? 3_000
        : false,
  });
}

/** "Eigene Arbeit": the files the student uploads to hand in. nunio stores them as they are and never reads them. */
export function OwnWork({
  apiOrigin,
  obligationId,
}: {
  apiOrigin: string;
  obligationId: string;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const query = ownWorkQuery(apiOrigin, obligationId);
  const files = useQuery(query);
  const refresh = () => queryClient.invalidateQueries(query);

  const upload = useMutation({
    mutationFn: async (chosen: File[]) => {
      if (chosen.some((file) => file.size < 1 || file.size > maxBytes))
        throw new Error("Eine Datei darf höchstens 14 MB groß sein.");
      const client = createApiClient(apiOrigin);
      for (const file of chosen) {
        const path = { id: obligationId };
        const created = await client.POST("/api/me/obligations/{id}/own-work", {
          params: { path },
          body: { name: file.name, bytes: file.size },
        });
        if (!created.data)
          throw new Error(`${file.name} konnte nicht hochgeladen werden.`);
        const put = await fetch(created.data.upload.url, {
          method: "PUT",
          headers: created.data.upload.headers,
          body: file,
          credentials: "omit",
        });
        if (!put.ok)
          throw new Error(
            `${file.name} wurde nicht fertig hochgeladen. Lösche die Datei und versuch es noch einmal.`,
          );
        const confirmed = await client.POST(
          "/api/me/obligations/{id}/own-work/{fileId}/confirm",
          { params: { path: { ...path, fileId: created.data.file.id } } },
        );
        if (!confirmed.data)
          throw new Error(`${file.name} konnte nicht gespeichert werden.`);
      }
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (fileId: string) => {
      const result = await createApiClient(apiOrigin).DELETE(
        "/api/me/obligations/{id}/own-work/{fileId}",
        { params: { path: { id: obligationId, fileId } } },
      );
      if (!result.data && result.response.status !== 404)
        throw new Error("Die Datei konnte nicht gelöscht werden.");
    },
    onSettled: refresh,
  });

  const error = files.error ?? upload.error ?? remove.error;
  const now = new Date();

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h2
          id={`${inputId}-title`}
          className="text-base font-medium text-base-800"
        >
          Eigene Arbeit
        </h2>
        <p className="text-[13px] leading-4.5 text-base-500">
          Die Dateien, die du abgibst. nunio speichert sie so, wie du sie
          hochlädst, und liest sie nicht.
        </p>
      </div>
      {files.data &&
        (files.data.length > 0 ? (
          <ul aria-label="Eigene Arbeit" className="flex flex-col">
            {files.data.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                now={now}
                deleting={remove.isPending && remove.variables === file.id}
                onDelete={() => remove.mutate(file.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-base-500">Noch keine Datei</p>
        ))}
      <div>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          aria-label="Eigene Arbeit hochladen"
          disabled={upload.isPending}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (chosen.length) upload.mutate(chosen);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? "Wird hochgeladen…" : "Eigene Arbeit hochladen"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive-600">
          {error.message}
        </p>
      )}
    </section>
  );
}

function FileRow({
  file,
  now,
  deleting,
  onDelete,
}: {
  file: OwnWorkFile;
  now: Date;
  deleting: boolean;
  onDelete: () => void;
}) {
  const pending = file.status === "uploading" || file.status === "promoting";
  return (
    <li className="flex items-center gap-2.5 border-t border-base-200 py-2.5">
      <FileText aria-hidden="true" className="size-4 shrink-0 text-base-400" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-base-800">
          {file.name}
        </span>
        {pending ? (
          <span className="flex items-center gap-1.5 text-xs text-base-500">
            <LoaderCircle
              aria-hidden="true"
              className="size-3 animate-spin text-primary-500"
            />
            Wird gespeichert…
          </span>
        ) : (
          file.status === "failed" && (
            <span className="text-xs text-destructive-600">
              Nicht gespeichert. Lösche die Datei und lade sie erneut hoch.
            </span>
          )
        )}
      </div>
      <span className="shrink-0 text-[13px] leading-4.5 text-base-500">
        {sizeText(file.bytes)}
      </span>
      <span className="w-[110px] shrink-0 text-[13px] leading-4.5 text-base-500">
        {draftDateText(file.uploadedAt, now)}
      </span>
      <button
        type="button"
        aria-label={`${file.name} löschen`}
        disabled={deleting}
        onClick={onDelete}
        className={cn(
          "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-base-500 hover:bg-base-100 hover:text-destructive-600",
          deleting && "opacity-50",
        )}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}
