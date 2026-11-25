import type { paths } from "@nunio/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Project =
  paths["/api/me/projects"]["get"]["responses"][200]["content"]["application/json"][number];
export type NewProject =
  paths["/api/me/projects"]["post"]["requestBody"]["content"]["application/json"];
/** An accepted Course with its Obligations, which a Project can relate to. */
export type ProjectCourse =
  paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
export type Obligation = ProjectCourse["obligations"][number];

/** The student's Projects. */
export function projectListQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "projects"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/projects", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Projekte konnten nicht geladen werden.");
      return result.data;
    },
  });
}

/** The accepted Courses a Project can relate to, with their Obligations. */
export function projectCoursesQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "projects", "courses"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/review", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Kurse konnten nicht geladen werden.");
      return result.data.courses.filter(
        (course) => course.status === "accepted",
      );
    },
  });
}

const refreshList = (apiOrigin: string, queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    queryKey: projectListQuery(apiOrigin).queryKey,
    exact: true,
  });

export function createProject(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: NewProject) => {
      const result = await createApiClient(apiOrigin).POST("/api/me/projects", {
        body,
      });
      if (!result.data)
        throw new Error(
          "Das Projekt wurde nicht erstellt. Versuche es noch einmal.",
        );
    },
    onSuccess: () => refreshList(apiOrigin, queryClient),
  });
}

export function renameProject(
  apiOrigin: string,
  id: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (name: string) => {
      const result = await createApiClient(apiOrigin).PATCH(
        "/api/me/projects/{id}",
        { params: { path: { id } }, body: { name } },
      );
      if (!result.data)
        throw new Error(
          "Das Projekt wurde nicht umbenannt. Versuche es noch einmal.",
        );
    },
    onSuccess: () => refreshList(apiOrigin, queryClient),
  });
}

/** Deletes only the Project; its Courses and Obligation stay. */
export function deleteProject(
  apiOrigin: string,
  id: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await createApiClient(apiOrigin).DELETE(
        "/api/me/projects/{id}",
        { params: { path: { id } } },
      );
      // Already gone is what the student wanted.
      if (!result.data && result.response.status !== 404)
        throw new Error(
          "Das Projekt wurde nicht gelöscht. Versuche es noch einmal.",
        );
    },
    onSuccess: () => refreshList(apiOrigin, queryClient),
  });
}
