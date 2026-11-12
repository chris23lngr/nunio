import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { createApiClient } from "@/lib/api-client";
import type { CourseChoice } from "../components/course-choice-fields";
import { sourceQueries } from "./source-queries";

/** Why the API refused the Course a Source was to be bound to, for the student to choose again; null if it did not. */
export function courseRefusal(
  status: number,
  body: { error?: string; course?: { title: string } } | undefined,
) {
  if (body?.error === "clash" && body.course)
    return `Es gibt schon einen Kurs mit diesem Titel oder Kürzel: ${body.course.title}. Wähle ihn aus, statt einen neuen anzulegen.`;
  return (
    {
      400: "Gib dem neuen Kurs einen Titel.",
      404: "Dieser Kurs ist nicht mehr verfügbar. Wähle einen anderen.",
      409: "Dieser Kurs ist archiviert. Hol ihn zurück oder wähle einen anderen.",
    }[status] ?? null
  );
}

export function uploadSource(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    /**
     * Uploads each file not yet in `done`, adding it there once processing is queued, so a retry skips it. A new
     * Course is created with the first file and reported through `onCourse`; the other files are bound to it by id.
     */
    mutationFn: async ({
      files,
      course,
      done,
      onCourse,
    }: {
      files: File[];
      course: CourseChoice;
      done: WeakSet<File>;
      onCourse: (courseId: string) => void;
    }) => {
      if (
        files.some(
          (file) =>
            file.size < 1 ||
            file.size > 20 * 1024 * 1024 ||
            !file.name.toLowerCase().endsWith(".pdf"),
        )
      ) {
        throw new Error("Choose a PDF up to 20 MB.");
      }
      const client = createApiClient(apiOrigin);
      let choice = course;
      for (const file of files.filter((file) => !done.has(file))) {
        const created = await client.POST("/api/me/sources", {
          body: {
            title: file.name,
            bytes: file.size,
            type: "application/pdf",
            course: choice,
          },
        });
        if (!created.data)
          throw new Error(
            created.response.status === 403
              ? "New uploads are unavailable for this account."
              : (courseRefusal(created.response.status, created.error) ??
                  "Could not start the upload."),
          );
        const { source, upload } = created.data;
        if (choice && !("id" in choice) && source.courseId)
          onCourse(source.courseId);
        choice = source.courseId ? { id: source.courseId } : null;
        const put = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: file,
          credentials: "omit",
        });
        if (!put.ok)
          throw new Error(
            "The upload did not finish. You can delete the unfinished Source below.",
          );
        const completed = await client.POST("/api/me/sources/{id}/complete", {
          params: { path: { id: source.id } },
        });
        if (!completed.data)
          throw new Error(
            "Could not start processing. Contact support before trying again.",
          );
        done.add(file);
      }
    },
    // A failed PUT can leave a Source that the student needs to delete; a new Course shows up in the choice.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(sourceQueries(apiOrigin)),
        queryClient.invalidateQueries(courseListQuery(apiOrigin)),
      ]),
  });
}

export function deleteSource(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const result = await createApiClient(apiOrigin).DELETE(
        "/api/me/sources/{id}",
        { params: { path: { id } } },
      );
      if (!result.data)
        throw new Error("Could not finish deletion. Please try again.");
      return result.data;
    },
    onSuccess: async (_data, id) => {
      await queryClient.cancelQueries(sourceQueries(apiOrigin));
      queryClient.setQueryData(sourceQueries(apiOrigin).queryKey, (sources) =>
        sources?.filter((source) => source.id !== id),
      );
      // Answers may depend on this Source even when it was not explicitly cited.
      await Promise.all([
        queryClient.resetQueries({ queryKey: [apiOrigin, "chats"] }),
        queryClient.resetQueries({
          queryKey: [apiOrigin, "source-document", id],
        }),
      ]);
      await queryClient.invalidateQueries(sourceQueries(apiOrigin));
    },
  });
}

export function readSourceAgain(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/sources/{id}/extract",
        { params: { path: { id } } },
      );
      if (!result.data)
        throw new Error("Could not start reading it again. Please try again.");
      return result.data;
    },
    onSettled: () => queryClient.invalidateQueries(sourceQueries(apiOrigin)),
  });
}

/** The Course changed and the Source waits to be read, but reading could not start; the student starts it again. */
export class ReadingNotStarted extends Error {}

/** "Kurs ändern": binds a ready Source to another Course, a new one, or none, and reads it again. */
export function changeSourceCourse(
  apiOrigin: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async ({
      id,
      course,
    }: {
      id: string;
      course: CourseChoice;
    }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/sources/{id}/course",
        { params: { path: { id } }, body: { course } },
      );
      if (result.data) return result.data;
      const { status } = result.response;
      if (status === 503)
        throw new ReadingNotStarted(
          "Der Kurs ist geändert, aber das Lesen konnte nicht starten. Starte es hier erneut.",
        );
      throw new Error(
        status === 409 && result.error?.error === "running"
          ? "Diese Quelle wird gerade gelesen. Ändere den Kurs, sobald das fertig ist."
          : status === 404
            ? "Diese Quelle oder dieser Kurs ist nicht mehr verfügbar."
            : (courseRefusal(status, result.error) ??
              "Das hat nicht geklappt. Der Kurs oben zeigt den aktuellen Stand; versuche es dann erneut."),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(sourceQueries(apiOrigin)),
        queryClient.invalidateQueries(courseListQuery(apiOrigin)),
      ]),
  });
}
