'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@pms/ui';
import { vnd } from '@/lib/format';
import { useOccupancyReport } from '@/lib/hooks/use-reports';
import { monthRange } from '@/lib/reports-period';

const fmtShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}tr` : n.toLocaleString('vi-VN'));

export function OccupancyReport({ propertyId, month }: { propertyId: string; month: string }) {
  const { from, to } = monthRange(month);
  const { data, isLoading } = useOccupancyReport(propertyId, from, to);

  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;
  const days = data.days;

  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Chưa có dữ liệu lấp đầy cho kỳ này (rollup do night-audit tổng hợp mỗi đêm).
      </p>
    );
  }

  const trend = days.map((d) => ({ date: d.stat_date.slice(8), adr: d.adr_vnd, revpar: d.revpar_vnd }));

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-sm font-medium">Heatmap lấp đầy theo ngày</p>
        <div className="flex flex-wrap gap-1">
          {days.map((d) => (
            <div
              key={d.stat_date}
              title={`${d.stat_date}: ${d.occupancy_rate_pct}% (${d.occupied_room_nights}/${d.available_room_nights} đêm)`}
              className="relative flex size-11 items-center justify-center rounded"
            >
              <span
                className="absolute inset-0 rounded"
                style={{ backgroundColor: 'var(--primary)', opacity: 0.1 + 0.9 * (d.occupancy_rate_pct / 100) }}
              />
              <span className="relative text-[10px] font-medium text-foreground">{d.stat_date.slice(8)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span>0%</span>
          <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--primary) 10%, transparent), var(--primary))' }} />
          <span>100%</span>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="mb-2 text-sm font-medium">ADR / RevPAR theo ngày</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} width={48} />
            <Tooltip formatter={(v: number) => vnd(v)} />
            <Line type="monotone" name="ADR" dataKey="adr" stroke="var(--primary)" strokeWidth={2} dot={false} />
            <Line type="monotone" name="RevPAR" dataKey="revpar" stroke="var(--booking-pending)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
