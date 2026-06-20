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

let browserQueryClient: QueryClient | undefined;

/**
 * Trình duyệt dùng 1 singleton (để logout / refresh-fail gọi
 * `getQueryClient().clear()` xoá cache — tránh người dùng kế trên cùng thiết bị
 * thấy dữ liệu của phiên trước). Server luôn tạo client mới mỗi request.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}
