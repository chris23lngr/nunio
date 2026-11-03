import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

export function createQueryClient() {
  const onError = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) {
      client.clear();
      window.location.replace("/sign-in");
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
