import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

/** Checks the student's answers to a practice set's Practice Items together; each becomes an Attempt. */
export function answersMutation(apiOrigin: string, artifactId: string) {
  return mutationOptions({
    mutationFn: async (answers: { itemId: string; text: string }[]) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts/{id}/attempts",
        { params: { path: { id: artifactId } }, body: { answers } },
      );
      if (!result.data)
        throw new Error(
          "Deine Antworten konnten nicht geprüft werden. Versuch es noch einmal.",
        );
      return result.data;
    },
  });
}
