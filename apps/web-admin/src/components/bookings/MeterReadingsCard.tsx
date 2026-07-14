'use client';

import { Skeleton } from '@pms/ui';
import type { MeterReadingResponse } from '@pms/shared-types';
import { useMeterReadings } from '@/lib/hooks/use-meter-readings';

/**
 * Số thực (kWh/m³, Decimal→Number từ BE) → chuỗi vi-VN (dấu phẩy thập phân); null → '—'.
 * KHÔNG dùng vnd() — đây là chỉ số công-tơ, KHÔNG phải tiền.
 */
function num(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/**
 * Tiêu thụ = end − start, làm tròn ≤2 chữ số. Thiếu đầu HOẶC cuối (kỳ chưa chốt) → '—'
 * (KHÔNG hiển thị NaN — seed kỳ hiện tại có end=NULL).
 */
function consumption(start: number | null, end: number | null): string {
  if (start == null || end == null) return '—';
  return num(Math.round((end - start) * 100) / 100);
}

const periodLabel = (r: MeterReadingResponse): string =>
  `${String(r.period_month).padStart(2, '0')}/${r.period_year}`;

/**
 * Card 'Điện/nước' read-only (task 2.7, docs/19 §3 Đợt 2 — task BE 3.8). CHỈ được page
 * render khi booking.mode==='MONTHLY'. Mỗi kỳ: chỉ số điện & nước đầu→cuối + cột tiêu thụ
 * (end−start). Kỳ chưa chốt (end=null) → '—'. Ghi chỉ số là chức năng của web-staff.
 */
export function MeterReadingsCard({ bookingId }: { bookingId: string }) {
  const { data: readings, isLoading } = useMeterReadings(bookingId, { enabled: true });

  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <p className="mb-3 font-medium">Điện/nước</p>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !readings || readings.length === 0 ? (
        <p className="text-muted-foreground">Chưa có chỉ số</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Kỳ</th>
                <th className="py-1 pr-3 font-medium">Điện (kWh)</th>
                <th className="py-1 pr-3 font-medium">Tiêu thụ</th>
                <th className="py-1 pr-3 font-medium">Nước (m³)</th>
                <th className="py-1 font-medium">Tiêu thụ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {readings.map((r) => (
                <tr key={r.id} className="tabular-nums">
                  <td className="whitespace-nowrap py-1.5 pr-3">{periodLabel(r)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    {num(r.electricity_kwh_start)} → {num(r.electricity_kwh_end)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {consumption(r.electricity_kwh_start, r.electricity_kwh_end)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    {num(r.water_m3_start)} → {num(r.water_m3_end)}
                  </td>
                  <td className="py-1.5">{consumption(r.water_m3_start, r.water_m3_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
