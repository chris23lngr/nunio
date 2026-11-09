import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";
import { responsibilityListQueries } from "./responsibility-queries";

export function prepareForExam(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (obligationId: string) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/responsibilities",
        {
          body: { preset: "prepare_for_exam", obligationId },
        },
      );
      if (!result.data) throw new Error("Could not delegate this exam.");
      return result.data.id;
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: responsibilityListQueries(apiOrigin).queryKey,
      }),
  });
}

export function keepCourseOrganized(
  apiOrigin: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (courseId: string) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/responsibilities",
        {
          body: { preset: "keep_course_organized", courseId },
        },
      );
      if (!result.data) throw new Error("Could not delegate this Course.");
      return result.data.id;
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: responsibilityListQueries(apiOrigin).queryKey,
      }),
  });
}

/** Pause stops its next Action, even mid-Run; only the student resumes; End removes its Grants for good. */
export function controlResponsibility(
  apiOrigin: string,
  id: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (control: "pause" | "resume" | "end") => {
      const path = `/api/me/responsibilities/{id}/${control}` as const;
      const result = await createApiClient(apiOrigin).POST(path, {
        params: { path: { id } },
      });
      if (!result.data)
        throw new Error("Could not change this Responsibility.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: responsibilityListQueries(apiOrigin).queryKey,
      }),
  });
}
