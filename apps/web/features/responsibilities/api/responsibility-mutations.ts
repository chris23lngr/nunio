import type { paths } from "@nunio/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";
import { responsibilityListQueries } from "./responsibility-queries";

type Delegate =
  paths["/api/me/responsibilities"]["post"]["requestBody"]["content"]["application/json"];

/** Delegates a Course ("keep this course organized") or one exam ("prepare me for this exam"). */
export function delegateResponsibility(
  apiOrigin: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (body: Delegate) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/responsibilities",
        { body },
      );
      if (!result.data)
        throw new Error(
          body.preset === "prepare_for_exam"
            ? "Could not delegate this exam."
            : "Could not delegate this Course.",
        );
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
