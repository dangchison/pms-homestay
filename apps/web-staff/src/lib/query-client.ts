import { QueryClient } from '@tanstack/react-query';

/** TanStack Query v5 — SSE chỉ là tín hiệu invalidate, REST là nguồn sự thật (docs/10). */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
