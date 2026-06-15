'use client';

import {
  Bar,
  BarChart,
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
import { usePnl, usePnlTrend } from '@/lib/hooks/use-reports';
import { lastNMonths, monthRange } from '@/lib/reports-period';

const fmtShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}tr` : n.toLocaleString('vi-VN'));

export function PnlReport({ propertyId, month }: { propertyId: string; month: string }) {
  const { from, to } = monthRange(month);
  const { data: pnl, isLoading } = usePnl(propertyId, from, to);
  const trendQueries = usePnlTrend(propertyId, lastNMonths(month, 6));

  if (isLoading || !pnl) return <Skeleton className="h-72 w-full" />;

  const cards = [
    { label: 'Doanh thu', value: pnl.revenue_total_vnd, accent: 'text-foreground' },
    { label: 'Chi phí trực tiếp', value: pnl.direct_cost_vnd, accent: 'text-muted-foreground' },
    { label: 'CP vận hành + khấu hao', value: pnl.operating_cost_vnd + pnl.depreciation_vnd, accent: 'text-muted-foreground' },
    { label: 'Lợi nhuận ròng', value: pnl.net_profit_vnd, accent: pnl.net_profit_vnd >= 0 ? 'text-booking-confirmed' : 'text-destructive' },
  ];

  const breakdown = [
    { name: 'Doanh thu', value: pnl.revenue_total_vnd },
    { name: 'CP trực tiếp', value: pnl.direct_cost_vnd },
    { name: 'CP vận hành', value: pnl.operating_cost_vnd + pnl.depreciation_vnd },
    { name: 'LN ròng', value: pnl.net_profit_vnd },
  ];

  const trend = trendQueries.map((q, i) => ({
    month: lastNMonths(month, 6)[i]!.label,
    net: q.data?.net_profit_vnd ?? 0,
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${c.accent}`}>{vnd(c.value)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-medium">Cơ cấu kỳ {month}</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={breakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} width={48} />
              <Tooltip formatter={(v: number) => vnd(v)} />
              <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-medium">Lợi nhuận ròng theo tháng</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} width={48} />
              <Tooltip formatter={(v: number) => vnd(v)} />
              <Line type="monotone" dataKey="net" stroke="var(--booking-confirmed)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Doanh thu ghi nhận khi check-out (docs/09 §8).</p>
    </div>
  );
}
