import { type LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { Card } from './card';
import { Sparkline } from './sparkline';

export type StatTone = 'brand' | 'blue' | 'violet' | 'amber' | 'emerald';

/** Map tone → cặp class chip (nền soft + chữ/icon) — token theme-aware. */
const TONE: Record<StatTone, { chip: string; spark: string }> = {
  brand: { chip: 'bg-chip-brand-soft text-chip-brand', spark: 'text-chip-brand' },
  blue: { chip: 'bg-chip-blue-soft text-chip-blue', spark: 'text-chip-blue' },
  violet: { chip: 'bg-chip-violet-soft text-chip-violet', spark: 'text-chip-violet' },
  amber: { chip: 'bg-chip-amber-soft text-chip-amber', spark: 'text-chip-amber' },
  emerald: { chip: 'bg-chip-emerald-soft text-chip-emerald', spark: 'text-chip-emerald' },
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  /** delta xu hướng so kỳ trước */
  delta?: { value: string; direction: 'up' | 'down' };
  /** dữ liệu sparkline; rỗng = không vẽ */
  data?: number[];
  /** ghi chú nhỏ dưới số (vd "OWNER / ACCOUNTANT") */
  note?: string;
  className?: string;
}

/**
 * KPI card (docs/ui/01 §D1, ui/00 §4.5 — props thuần, tách khỏi data-hook).
 * Số lớn tabular-nums + chip icon tone + delta + sparkline. Chỉ dùng token.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  delta,
  data,
  note,
  className,
}: StatCardProps) {
  const t = TONE[tone];
  const deltaUp = delta?.direction === 'up';

  return (
    <Card elevation="low" className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex size-10 items-center justify-center rounded-xl', t.chip)}>
          <Icon className="size-5" />
        </span>
        {data && data.length > 1 && <Sparkline data={data} className={cn('opacity-80', t.spark)} />}
      </div>

      <div className="mt-4 text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              deltaUp ? 'text-success' : 'text-destructive',
            )}
          >
            {deltaUp ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {delta.value}
          </span>
        )}
      </div>
      {note && <div className="mt-1 text-[11px] text-subtle-foreground">{note}</div>}
    </Card>
  );
}
