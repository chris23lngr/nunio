import type { paths } from "@nunio/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";
import {
  agentCourseQueries,
  agentListQueries,
  agentQueries,
} from "./agent-queries";

type Delegate = Extract<
  paths["/api/me/agents"]["post"]["requestBody"]["content"]["application/json"],
  { preset: string }
>;

/** Delegates a Course ("keep this course organized") or one exam ("prepare me for this exam"). */
export function delegateAgent(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: Delegate) => {
      const result = await createApiClient(apiOrigin).POST("/api/me/agents", {
        body,
      });
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
        queryKey: agentListQueries(apiOrigin).queryKey,
      }),
  });
}

export type AgentForm =
  paths["/api/me/agents/{id}"]["put"]["requestBody"]["content"]["application/json"];

/** Saves a free-text Agent's whole form: creates it when it has no id yet. Resolves to its id. */
export function saveAgent(
  apiOrigin: string,
  id: string | undefined,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (body: AgentForm) => {
      const client = createApiClient(apiOrigin);
      const result = id
        ? await client.PUT("/api/me/agents/{id}", {
            params: { path: { id } },
            body,
          })
        : await client.POST("/api/me/agents", { body });
      if (result.response.status === 409)
        throw new Error(
          "Einer deiner Kurse wurde inzwischen archiviert. Wähle ihn ab und speichere noch einmal.",
        );
      if (!result.data)
        throw new Error(
          "Dein Agent wurde nicht gespeichert. Versuche es noch einmal.",
        );
      return id ?? (result.data as { id: string }).id;
    },
    onSuccess: (saved) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentListQueries(apiOrigin).queryKey,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueries(apiOrigin, saved).queryKey,
        }),
      ]),
    // A Course may have been Archived or deleted meanwhile: show which, so it can be taken off.
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: agentCourseQueries(apiOrigin).queryKey,
      }),
  });
}

/** Pause stops its next Action, even mid-Run; only the student resumes; End removes its Grants for good. */
export function controlAgent(
  apiOrigin: string,
  id: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (control: "pause" | "resume" | "end") => {
      const path = `/api/me/agents/{id}/${control}` as const;
      const result = await createApiClient(apiOrigin).POST(path, {
        params: { path: { id } },
      });
      if (!result.data) throw new Error("Could not change this Agent.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: agentListQueries(apiOrigin).queryKey,
      }),
  });
}
