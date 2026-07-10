'use client';

import { Badge, Skeleton } from '@pms/ui';
import type { AntiFraudFindingType, AntiFraudSeverity } from '@pms/shared-types';
import { vnd } from '@/lib/format';
import { useAntiFraud } from '@/lib/hooks/use-reports';
import { monthRange } from '@/lib/reports-period';

const TYPE_LABEL: Record<AntiFraudFindingType, string> = {
  CANCEL_AFTER_CASH: 'Hủy sau khi thu tiền mặt',
  REFUND_ANOMALY_BY_STAFF: 'Hoàn tiền bất thường theo nhân viên',
  NO_SHOW_DEPOSIT_REMOVED: 'No-show bị rút cọc',
  PRICE_EDIT_AFTER_CHECKIN: 'Sửa giá sau khi check-in',
};

const SEVERITY: Record<
  AntiFraudSeverity,
  { label: string; variant: 'destructive' | 'default' | 'secondary' }
> = {
  HIGH: { label: 'Cao', variant: 'destructive' },
  MEDIUM: { label: 'Trung bình', variant: 'default' },
  LOW: { label: 'Thấp', variant: 'secondary' },
};

const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * #11 Báo cáo dấu hiệu thất thoát tiền mặt. KHÔNG lộ PII khách — chỉ mã đặt phòng
 * + nhân viên liên quan. Chỉ là dấu hiệu cần rà soát, không kết luận gian lận.
 */
export function AntiFraudReport({ propertyId, month }: { propertyId: string; month: string }) {
  const { from, to } = monthRange(month);
  const { data, isLoading } = useAntiFraud(propertyId, from, to);

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  if (data.findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Không phát hiện dấu hiệu bất thường trong kỳ {month}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md bg-muted px-2 py-1">
          Tổng: <b>{data.summary.total}</b>
        </span>
        {Object.entries(data.summary.by_severity).map(([sev, n]) => (
          <span key={sev} className="rounded-md bg-muted px-2 py-1">
            {SEVERITY[sev as AntiFraudSeverity]?.label ?? sev}: <b>{n}</b>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Thời điểm</th>
              <th className="px-3 py-2 font-medium">Dấu hiệu</th>
              <th className="px-3 py-2 font-medium">Mức độ</th>
              <th className="px-3 py-2 font-medium">Mã đặt phòng</th>
              <th className="px-3 py-2 font-medium">Nhân viên</th>
              <th className="px-3 py-2 text-right font-medium">Số tiền</th>
              <th className="px-3 py-2 font-medium">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.findings.map((f, i) => {
              const sev = SEVERITY[f.severity];
              return (
                <tr key={`${f.entity_type}-${f.entity_id}-${i}`}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {VN_DATETIME.format(new Date(f.occurred_at))}
                  </td>
                  <td className="px-3 py-2">{TYPE_LABEL[f.type] ?? f.type}</td>
                  <td className="px-3 py-2">
                    <Badge variant={sev.variant}>{sev.label}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{f.booking_code ?? '—'}</td>
                  <td className="px-3 py-2">{f.staff_name ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{vnd(f.amount_vnd)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{f.detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Chỉ là DẤU HIỆU cần rà soát — không kết luận gian lận. Nguồn: nhật ký kiểm toán + tiền mặt.
      </p>
    </div>
  );
}
