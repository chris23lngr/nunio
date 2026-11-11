import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { createApiClient } from "@/lib/api-client";
import type { CourseChoice } from "../components/course-choice-fields";
import { sourceQueries } from "./source-queries";

/** Why the API refused the Course a Source was to be bound to, for the student to choose again. */
export const courseRefusals: Record<number, string> = {
  400: "Gib dem neuen Kurs einen Titel.",
  404: "Dieser Kurs ist nicht mehr verfügbar. Wähle einen anderen.",
  409: "Dieser Kurs ist archiviert. Hol ihn zurück oder wähle einen anderen.",
};

export function uploadSource(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async ({
      files,
      course,
    }: {
      files: File[];
      course: CourseChoice;
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
      // A new Course is created with the first file; the others are bound to it by id.
      let choice = course;
      for (const file of files) {
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
              : (courseRefusals[created.response.status] ??
                  "Could not start the upload."),
          );
        const { source, upload } = created.data;
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
      throw new Error(
        status === 409 && result.error?.error === "running"
          ? "Diese Quelle wird gerade gelesen. Ändere den Kurs, sobald das fertig ist."
          : status === 404
            ? "Diese Quelle oder dieser Kurs ist nicht mehr verfügbar."
            : (courseRefusals[status] ??
              "Der Kurs konnte nicht geändert werden. Bitte versuche es erneut."),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(sourceQueries(apiOrigin)),
        queryClient.invalidateQueries(courseListQuery(apiOrigin)),
      ]),
  });
}
