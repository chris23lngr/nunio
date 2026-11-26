import type { paths } from "@nunio/api-client";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@/lib/api-client";

type Json<T> = T extends { content: { "application/json": infer B } }
  ? B
  : never;
type FoldersRoute = paths["/api/me/connections/email/folders"]["get"];

export type ConnectionDetail = Json<
  paths["/api/me/connections/{integrationKey}"]["get"]["responses"][200]
>;
export type ConnectionTool = ConnectionDetail["tools"][number];
/** Why the mailbox's folders couldn't be listed or set. */
export type FolderRefusal = Json<FoldersRoute["responses"][422]>;

export class FoldersRefused extends Error {
  constructor(readonly refusal: FolderRefusal) {
    super(`Folders refused: ${refusal.error}`);
    this.name = "FoldersRefused";
  }
}

/** The student has no Connection to the Integration. */
export class ConnectionGone extends Error {
  constructor() {
    super("The Connection is gone.");
    this.name = "ConnectionGone";
  }
}

export function connectionQuery(apiOrigin: string, integrationKey: string) {
  return queryOptions({
    queryKey: [apiOrigin, "connections", integrationKey],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/connections/{integrationKey}",
        { params: { path: { integrationKey } }, signal },
      );
      if (result.data) return result.data;
      if (result.response.status === 404) throw new ConnectionGone();
      throw new Error("Could not load the Connection.");
    },
    retry: (failures, error) =>
      !(error instanceof ConnectionGone) && failures < 1,
  });
}

/** The mailbox's folders, listed by logging in with the stored credentials. */
export function mailboxFoldersQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "mailbox-folders"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/connections/email/folders",
        { signal },
      );
      if (result.data) return result.data.folders;
      if (result.response.status === 422 && result.error)
        throw new FoldersRefused(result.error as FolderRefusal);
      throw new Error("Could not list the folders.");
    },
    retry: (failures, error) =>
      !(error instanceof FoldersRefused) && failures < 1,
  });
}

/** Sets a write tool to Nachfragen or Immer erlaubt. */
export function toolModeMutation(apiOrigin: string, integrationKey: string) {
  return mutationOptions({
    mutationFn: async ({
      toolName,
      mode,
    }: {
      toolName: string;
      mode: "ask" | "always_allowed";
    }) => {
      const result = await createApiClient(apiOrigin).PUT(
        "/api/me/connections/{integrationKey}/tools/{toolName}",
        { params: { path: { integrationKey, toolName } }, body: { mode } },
      );
      if (!result.data)
        throw new ApiError(
          result.response.status,
          "Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.",
        );
    },
  });
}

/** Sets the folders nunio may read. */
export function foldersMutation(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (folders: string[]) => {
      const result = await createApiClient(apiOrigin).PUT(
        "/api/me/connections/email/folders",
        { body: { folders } },
      );
      if (result.data) return;
      if (result.response.status === 422 && result.error)
        throw new FoldersRefused(result.error as FolderRefusal);
      throw new ApiError(
        result.response.status,
        "Die Ordner konnten nicht gespeichert werden. Bitte versuche es erneut.",
      );
    },
  });
}
