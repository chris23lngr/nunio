import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

export function createQueryClient(onUnauthorized: () => void) {
  const onError = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) {
      client.clear();
      onUnauthorized();
    }
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) => !(error instanceof ApiError && error.status === 401) && failures < 1,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
