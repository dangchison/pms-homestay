'use client';

import { Skeleton, cn } from '@pms/ui';
import type { QuoteResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';

interface Props {
  quote: QuoteResponse | undefined;
  isLoading: boolean;
  error: unknown;
  enabled: boolean;
}

/** Bảng báo giá sống (task 6.3, F1 §3): từng dòng + tổng + **cọc cần thu**. */
export function QuoteBreakdown({ quote, isLoading, error, enabled }: Props) {
  if (!enabled) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Chọn phòng và khoảng thời gian để xem báo giá.
      </p>
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-6 w-1/3" />
      </div>
    );
  }
  if (error) {
    const msg = error instanceof ApiClientError ? error.message : 'Không tính được giá — kiểm tra lại input';
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive-muted p-4 text-sm text-foreground">
        {msg}
      </p>
    );
  }
  if (!quote) return null;

  // Dedupe voucher: discount_vnd (dòng tổng "Giảm giá" bên dưới) ĐÃ = tổng các dòng
  // line_items type DISCOUNT (pricing-engine/builder + pricing.service). Lọc chúng khỏi
  // vòng lặp itemized để KHÔNG hiển thị hai lần (một lần itemized + một lần dòng tổng).
  const itemized = quote.line_items.filter((li) => li.type !== 'DISCOUNT');

  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <ul className="divide-y divide-border/60">
        {itemized.map((li, i) => (
          <li key={`${li.type}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-muted-foreground">
              {li.description}
              {li.quantity > 1 && <span className="ml-1 text-xs">×{li.quantity}</span>}
            </span>
            <span className={cn('tabular-nums', li.amount_vnd < 0 && 'text-emerald-600')}>{vnd(li.amount_vnd)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1 border-t border-border pt-3">
        <Row label="Tạm tính" value={vnd(quote.subtotal_vnd)} muted />
        {quote.discount_vnd !== 0 && <Row label="Giảm giá" value={vnd(-Math.abs(quote.discount_vnd))} muted />}
        {quote.tax_vnd !== 0 && <Row label="Thuế" value={vnd(quote.tax_vnd)} muted />}
        <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
          <span>Tổng</span>
          <span className="tabular-nums">{vnd(quote.total_vnd)}</span>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
        <span className="font-medium text-primary">Cọc cần thu</span>
        <span className="font-semibold tabular-nums text-primary">{vnd(quote.deposit_vnd)}</span>
      </div>

      {quote.holidays.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Có ngày lễ trong kỳ: {quote.holidays.map((h) => h.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between', muted && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
