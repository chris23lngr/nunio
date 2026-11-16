import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, EllipsisVertical, File, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import {
  deleteSource,
  uploadSource,
} from "@/features/sources/api/source-mutations";
import { sourceDocumentQueries } from "@/features/sources/api/source-queries";
import type { CoursePage } from "../api/course-queries";
import { coursePageQuery } from "../api/course-queries";
import { dayAgoText } from "../course-format";
import { ConfirmDialog } from "./confirm-dialog";

type Source = CoursePage["sources"][number];

const size = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** A file size as Paper shows it: "250 MiB", or KiB below one MiB. */
function bytesText(bytes: number) {
  const mib = bytes / 1024 / 1024;
  return mib >= 1
    ? `${size.format(mib)} MiB`
    : `${size.format(Math.max(bytes / 1024, 1))} KiB`;
}

/** Uploads PDFs straight into the Course. */
export function UploadButton({
  apiOrigin,
  courseId,
}: {
  apiOrigin: string;
  courseId: string;
}) {
  const queryClient = useQueryClient();
  const upload = useMutation({
    ...uploadSource(apiOrigin, queryClient),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(coursePageQuery(apiOrigin, courseId)),
        queryClient.invalidateQueries({ queryKey: [apiOrigin, "sources"] }),
      ]),
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex cursor-pointer items-center gap-2 rounded-sm text-sm font-medium text-primary-500 hover:text-primary-600 has-focus-visible:ring-2 has-focus-visible:ring-primary-500 has-focus-visible:ring-offset-4">
        {upload.isPending ? "Wird hochgeladen …" : "Hochladen"}
        <Upload aria-hidden="true" className="size-4" />
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          aria-label="Hochladen"
          disabled={upload.isPending}
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            if (files.length)
              upload.mutate({
                files,
                course: { id: courseId },
                done: new WeakSet(),
                onCourse: () => {},
              });
          }}
        />
      </label>
      {upload.error && (
        <p role="alert" className="text-sm text-destructive-600">
          {upload.error.message}
        </p>
      )}
    </div>
  );
}

/** The Course's Sources, each to download or delete. */
export function CourseSources({
  apiOrigin,
  courseId,
  sources,
  now,
}: {
  apiOrigin: string;
  courseId: string;
  sources: Source[];
  now: Date;
}) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<Source | null>(null);
  const remove = useMutation({
    ...deleteSource(apiOrigin, queryClient),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries(coursePageQuery(apiOrigin, courseId));
    },
  });
  const download = useMutation({
    mutationFn: async (source: Source) => {
      const { blob, title } = await queryClient.fetchQuery(
        sourceDocumentQueries(apiOrigin, source.id),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = title;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  if (!sources.length)
    return (
      <div className="flex flex-col items-center gap-0.5 rounded-lg border border-dashed border-base-200 py-6 text-center">
        <p className="text-sm font-medium text-base-800">Keine Quellen</p>
        <p className="text-xs text-base-500">
          Lade Skripte, Folien oder Modulhandbücher hoch, damit nunio den Kurs
          kennenlernt.
        </p>
      </div>
    );
  return (
    <>
      <ul aria-label="Quellen" className="flex flex-col gap-3">
        {sources.map((source) => (
          <li
            key={source.id}
            className="flex items-start gap-2.5 rounded-lg border border-base-200 py-3.5 pr-6 pl-4"
          >
            <File
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-base-500"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              <span className="truncate font-medium text-base-700">
                {source.title}
              </span>
              <span className="truncate text-base-500">
                {dayAgoText(source.createdAt, now)} • {bytesText(source.bytes)}
              </span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-4 self-center"
                    aria-label={`Aktionen für ${source.title}`}
                  />
                }
              >
                <EllipsisVertical aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => download.mutate(source)}>
                    <Download aria-hidden="true" />
                    Herunterladen
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(source)}
                  >
                    <Trash2 aria-hidden="true" />
                    Löschen
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      {download.error && (
        <p role="alert" className="text-sm text-destructive-600">
          {download.error.message}
        </p>
      )}
      {deleting && (
        <ConfirmDialog
          title="Quelle löschen?"
          confirm="Endgültig löschen"
          destructive
          pending={remove.isPending}
          error={remove.error?.message ?? null}
          onCancel={() => {
            setDeleting(null);
            remove.reset();
          }}
          onConfirm={() => remove.mutate(deleting.id)}
        >
          „{deleting.title}“ und alles, was nunio daraus gelesen hat, werden
          gelöscht, auch in anderen Kursen. Das lässt sich nicht rückgängig
          machen.
        </ConfirmDialog>
      )}
    </>
  );
}
