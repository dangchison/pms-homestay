import { useQuery } from '@tanstack/react-query';
import type { QuoteRequest, QuoteResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Live quote (task 6.3, flow F1 bước 3). Caller debounce input rồi truyền vào —
 * hook là useQuery thuần (queryKey gồm input → cache theo bộ tham số). `retry:false`
 * vì 422 validation không nên thử lại. enabled khi đủ input + check_out > check_in.
 */
export function useQuote(input: QuoteRequest | null) {
  const ready = !!input && new Date(input.check_out) > new Date(input.check_in);
  return useQuery({
    queryKey: ['quote', input],
    queryFn: () =>
      apiClient.post<{ data: QuoteResponse }>('/pricing/quote', input).then((r) => r.data),
    enabled: ready,
    retry: false,
    staleTime: 30_000,
  });
}
