import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import type { BreakEvenResponse, OccupancyReportResponse, PnlResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { downloadBlob } from '@/lib/download';

/** R1 — P&L cho [from,to] (task 6.5). */
export function usePnl(propertyId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['reports', 'pnl', propertyId ?? '', from, to],
    queryFn: () =>
      apiClient
        .get<{ data: PnlResponse }>(`/reports/pnl?property_id=${propertyId}&from=${from}&to=${to}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}

/** R1 — trend nhiều tháng (mỗi tháng 1 lần gọi pnl, song song). */
export function usePnlTrend(propertyId: string | null, periods: { label: string; from: string; to: string }[]) {
  return useQueries({
    queries: periods.map((p) => ({
      queryKey: ['reports', 'pnl', propertyId ?? '', p.from, p.to],
      queryFn: () =>
        apiClient
          .get<{ data: PnlResponse }>(`/reports/pnl?property_id=${propertyId}&from=${p.from}&to=${p.to}`)
          .then((r) => r.data),
      enabled: !!propertyId,
    })),
  });
}

/** R2 — break-even 3 kịch bản cho 1 tháng (YYYY-MM). */
export function useBreakEven(propertyId: string | null, period: string) {
  return useQuery({
    queryKey: ['reports', 'break-even', propertyId ?? '', period],
    queryFn: () =>
      apiClient
        .get<{ data: BreakEvenResponse }>(`/reports/break-even?property_id=${propertyId}&period=${period}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}

/** R3 — occupancy theo ngày cho [from,to]. */
export function useOccupancyReport(propertyId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['reports', 'occupancy', propertyId ?? '', from, to],
    queryFn: () =>
      apiClient
        .get<{ data: OccupancyReportResponse }>(`/reports/occupancy?property_id=${propertyId}&from=${from}&to=${to}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}

/** Xuất Excel (P&L + lấp đầy theo ngày) cho [from,to] — tải file có auth. */
export function useExportReportsXlsx() {
  return useMutation({
    mutationFn: ({ propertyId, from, to }: { propertyId: string; from: string; to: string }) =>
      downloadBlob(
        `/reports/export?property_id=${propertyId}&from=${from}&to=${to}`,
        `bao-cao-${from}_${to}.xlsx`,
      ),
  });
}
