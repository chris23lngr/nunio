import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";
import { sourceQueries } from "./source-queries";

export function uploadSource(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (file: File) => {
      if (file.size < 1 || file.size > 20 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Choose a PDF up to 20 MB.");
      }
      const client = createApiClient(apiOrigin);
      const created = await client.POST("/api/me/sources", { body: { title: file.name, bytes: file.size, type: "application/pdf" } });
      if (!created.data) throw new Error(created.response.status === 403 ? "New uploads are unavailable for this account." : "Could not start the upload.");
      const { source, upload } = created.data;
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file, credentials: "omit" });
      if (!put.ok) throw new Error("The upload did not finish. You can delete the unfinished Source below.");
      const completed = await client.POST("/api/me/sources/{id}/complete", { params: { path: { id: source.id } } });
      if (!completed.data) throw new Error("Could not start processing. Contact support before trying again.");
      return completed.data;
    },
    // A failed PUT can leave a Source that the student needs to delete.
    onSettled: () => queryClient.invalidateQueries(sourceQueries(apiOrigin)),
  });
}

export function deleteSource(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const result = await createApiClient(apiOrigin).DELETE("/api/me/sources/{id}", { params: { path: { id } } });
      if (!result.data) throw new Error("Could not finish deletion. Please try again.");
      return result.data;
    },
    onSuccess: async (_data, id) => {
      await queryClient.cancelQueries(sourceQueries(apiOrigin));
      queryClient.setQueryData(sourceQueries(apiOrigin).queryKey, sources => sources?.filter(source => source.id !== id));
      await queryClient.invalidateQueries(sourceQueries(apiOrigin));
    },
  });
}

export function readSourceAgain(apiOrigin: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const result = await createApiClient(apiOrigin).POST("/api/me/sources/{id}/extract", { params: { path: { id } } });
      if (!result.data) throw new Error("Could not start reading it again. Please try again.");
      return result.data;
    },
    onSettled: () => queryClient.invalidateQueries(sourceQueries(apiOrigin)),
  });
}
