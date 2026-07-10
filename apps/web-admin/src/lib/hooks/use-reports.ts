import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import type {
  AntiFraudResponse,
  BreakEvenResponse,
  LandlordStatementResponse,
  OccupancyReportResponse,
  PnlResponse,
} from '@pms/shared-types';
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

/**
 * #14 Bảng kê chủ nhà gốc (R2R) cho [from,to]. Chỉ gọi khi cơ sở `is_rent_to_rent`
 * (tham số `enabled`) — tránh 422 NOT_RENT_TO_RENT với cơ sở thường.
 */
export function useLandlordStatement(
  propertyId: string | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['reports', 'landlord-statement', propertyId ?? '', from, to],
    queryFn: () =>
      apiClient
        .get<{ data: LandlordStatementResponse }>(
          `/reports/landlord-statement?property_id=${propertyId}&from=${from}&to=${to}`,
        )
        .then((r) => r.data),
    enabled: !!propertyId && enabled,
  });
}

/** #11 Anti-fraud — dấu hiệu thất thoát tiền mặt cho [from,to] (KHÔNG PII khách). */
export function useAntiFraud(propertyId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['reports', 'anti-fraud', propertyId ?? '', from, to],
    queryFn: () =>
      apiClient
        .get<{ data: AntiFraudResponse }>(
          `/reports/anti-fraud?property_id=${propertyId}&from=${from}&to=${to}`,
        )
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
