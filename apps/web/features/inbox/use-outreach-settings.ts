import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsQueries, updateSettings } from "./api/settings-queries";

/** The student's outreach settings and the one way to change them, shared by every settings section. */
export function useOutreachSettings(apiOrigin: string) {
  const queryClient = useQueryClient();
  return {
    query: useQuery(settingsQueries(apiOrigin)),
    update: useMutation(updateSettings(apiOrigin, queryClient)),
  };
}
