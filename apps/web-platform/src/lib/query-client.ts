import { QueryClient } from '@tanstack/react-query';

/** Console nội bộ: dữ liệu cấu hình đổi thưa, staleTime ngắn là đủ tươi. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}
